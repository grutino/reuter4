// Qué mira cada red: cuánto mueve la predicción tocar un rasgo.
//
// Se perturba cada entrada arriba y abajo sobre vectores REALES —no sobre ceros—
// y se mide cuánto cambia la salida. Es lo más parecido a preguntarle a la red
// qué le importa, y es lo que permite ver si un rasgo está muerto, si uno domina
// a los demás, o si la red aprendió lo contrario de lo que se esperaba.
//
// Hay una función por red porque los vectores se generan de forma distinta: los
// de despliegue salen de posiciones iniciales, y los de jugada de jugadas
// concretas en partidas en curso. Compartir el código y no los datos daría una
// sensibilidad medida sobre entradas que la red nunca ve.

import { COLORES } from "../src/motor/tablero.js";
import { nuevaPartida, aplicar, movimientosLegales, reclutar, recogerLaBandera, renunciarARecoger } from "../src/motor/motor.js";
import { accionDeBot, decisionDeRecogida, despliegueAleatorio, DISTANCIA } from "../src/motor/bot.js";
import { analizarTurno } from "../src/motor/analisis.js";
import { evaluar } from "../src/motor/red.js";
import { rasgosDeDespliegue, nombreDeRasgo } from "../src/motor/rasgos-despliegue.js";
import { rasgosDeJugada, contextoDeTurno, NOMBRES as NOMBRES_JUGADA } from "../src/motor/rasgos-jugada.js";
import { generador } from "./arena.mjs";

// El núcleo, común: perturbar cada entrada sobre una colección de vectores.
function efectoPorEntrada(red, vectores, paso) {
  if (!vectores.length) return [];
  const efecto = new Float64Array(vectores[0].length);
  for (const vector of vectores) {
    for (let k = 0; k < vector.length; k++) {
      const original = vector[k];
      vector[k] = Math.min(1, original + paso);
      const arriba = evaluar(red, vector);
      vector[k] = Math.max(0, original - paso);
      const abajo = evaluar(red, vector);
      vector[k] = original;
      efecto[k] += arriba - abajo;
    }
  }
  return Array.from(efecto, (v) => v / vectores.length);
}

// Los vectores, sueltos: los usa la sensibilidad y también la ablación, y
// generarlos dos veces cuesta jugar las partidas dos veces.
export function entradasDeDespliegue({ muestras = 400, semilla = 97 } = {}) {
  const azar = generador(semilla);
  const vectores = [];
  for (let i = 0; i < muestras; i++) {
    const color = COLORES[i % 4];
    vectores.push(rasgosDeDespliegue(color, despliegueAleatorio(color, azar)));
  }
  return vectores;
}

export function sensibilidadDeDespliegue(red, { muestras = 400, paso = 0.15, semilla = 97 } = {}) {
  const vectores = entradasDeDespliegue({ muestras, semilla });
  return efectoPorEntrada(red, vectores, paso).map((efecto, indice) => ({
    indice, efecto, nombre: nombreDeRasgo(indice),
  }));
}

// Los vectores de jugada tienen que salir de partidas en curso: una jugada solo
// existe dentro de una posición. Se muestrea a lo largo de la partida para que
// entren aperturas, medio juego y finales, que es donde los rasgos del castillo
// cobran valores distintos de cero.
export function entradasDeJugada({ partidas = 24, semilla = 5150, cadaTurnos = 7, porTurno = 6 } = {}) {
  const vectores = [];
  for (let p = 0; p < partidas; p++) {
    const azar = generador(semilla + p * 7919);
    const despliegues = {};
    for (const color of COLORES) despliegues[color] = despliegueAleatorio(color, azar);
    let estado = nuevaPartida(despliegues, { primero: COLORES[Math.floor(azar() * 4)] });
    let turnos = 0;
    while (!estado.fin && turnos < 300) {
      if (estado.pendiente) {
        const q = estado.pendiente;
        estado = q.tipo === "recoger"
          ? decisionDeRecogida(estado, q.color) ? recogerLaBandera(estado) : renunciarARecoger(estado)
          : reclutar(estado, Math.max(...q.opciones));
        continue;
      }
      if (turnos % cadaTurnos === 0) {
        const color = estado.turno;
        const contexto = contextoDeTurno(estado, color, analizarTurno(estado, color, DISTANCIA));
        // SIEMPRE LOS ATAQUES Y DISPAROS, y luego se rellena con movimientos.
        // Cogiendo las seis primeras legales tal cual, el combate no salía casi
        // nunca -en las partidas es el 2% de las jugadas y encima suele ir al
        // final de la lista-, y con esa muestra media docena de rasgos parecían
        // constantes: `valorEsperadoDelDuelo` salía siempre en 0,5, que es su
        // valor neutro cuando no hay a quién atacar.
        //
        // Importa más de lo que parece: estas entradas son las que miden la
        // ablación y la linealidad de la red, así que una muestra sin combate
        // estaba juzgando a la red solo en el régimen fácil.
        const legales = movimientosLegales(estado, color);
        const combate = legales.filter((a) => a.tipo === "atacar" || a.tipo === "disparar");
        const resto = legales.filter((a) => a.tipo !== "atacar" && a.tipo !== "disparar");
        const elegidas = combate.concat(resto).slice(0, porTurno);
        for (const accion of elegidas) {
          vectores.push(rasgosDeJugada(estado, color, accion, contexto));
        }
      }
      const accion = accionDeBot(estado, estado.turno, { azar });
      if (!accion) break;
      estado = aplicar(estado, accion);
      turnos++;
    }
  }
  return vectores;
}

export function sensibilidadDeJugada(red, { partidas = 24, paso = 0.15, semilla = 5150, cadaTurnos = 7, porTurno = 6 } = {}) {
  const vectores = entradasDeJugada({ partidas, semilla, cadaTurnos, porTurno });
  return efectoPorEntrada(red, vectores, paso).map((efecto, indice) => ({
    indice, efecto, nombre: NOMBRES_JUGADA[indice] || `rasgo ${indice}`,
  }));
}

// Los que no mueven nada. Un rasgo plano o está mal calculado o no distingue
// nada, y en los dos casos conviene enterarse: `juntoALago` estuvo nueve veces
// muerto porque medía una adyacencia que no puede darse.
export function planos(sensibilidad, umbral = 5e-4) {
  return sensibilidad.filter((r) => Math.abs(r.efecto) < umbral);
}
