// Banco de pruebas del entrenamiento: enfrenta dos configuraciones de bot y
// devuelve quién gana. Vive fuera de `src/` a propósito: el servidor no importa
// nada de aquí, y así el entrenamiento puede crecer sin engordar el juego.
//
// Dos decisiones que hacen que los números sean fiables:
//
//   1. Semilla. Todo el azar de una partida —los cuatro despliegues y los
//      desempates de los bots— sale de un generador con semilla. La misma
//      semilla da exactamente la misma partida.
//   2. Números aleatorios comunes. Cada emparejamiento se juega dos veces con
//      la misma semilla, cambiando a los dos bandos de lado. Así el resultado
//      no depende de que a uno le tocara un despliegue mejor, que en un tablero
//      asimétrico como este es la mayor fuente de ruido.

import { COLORES } from "../src/motor/tablero.js";
import {
  nuevaPartida,
  aplicar,
  movimientosLegales,
  reclutar,
  recogerLaBandera,
  renunciarARecoger,
  EQUIPOS,
} from "../src/motor/motor.js";
import { accionDeBot, decisionDeRecogida, despliegueAleatorio, PESOS_BASE, DISTANCIA } from "../src/motor/bot.js";

export const LIMITE_TURNOS = 4000;

// mulberry32: pequeño, rápido y con secuencia decente. No hace falta más.
export function generador(semilla) {
  let a = semilla >>> 0;
  return function azar() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Una configuración de bot: los pesos y las perillas que gradúan su fuerza.
export function configuracion(parcial = {}) {
  return {
    pesos: parcial.pesos || PESOS_BASE,
    // Fracción de los rangos revelados que el bot recuerda. 1 = memoria perfecta.
    memoria: parcial.memoria === undefined ? 1 : parcial.memoria,
    // Probabilidad de jugar al azar en vez de lo que dice la heurística.
    despiste: parcial.despiste === undefined ? 0 : parcial.despiste,
    nombre: parcial.nombre || "sin nombre",
  };
}

// Recorta la memoria pública a lo que este bot es capaz de recordar. Se hace
// sobre una copia: el estado real no se toca, que es de la partida y no suya.
function estadoParaBot(estado, config, azar) {
  if (config.memoria >= 1) return estado;
  const recordado = {};
  for (const [id, rango] of Object.entries(estado.rangosRevelados || {})) {
    if (azar() < config.memoria) recordado[id] = rango;
  }
  return { ...estado, rangosRevelados: recordado };
}

export function jugadaDe(estado, color, config, azar) {
  const visto = estadoParaBot(estado, config, azar);
  if (config.despiste > 0 && azar() < config.despiste) {
    // Despiste: una jugada legal cualquiera, para que los niveles bajos fallen
    // de vez en cuando sin dejar de ser jugadores coherentes.
    const opciones = movimientosLegales(visto, color);
    if (opciones.length) return opciones[Math.floor(azar() * opciones.length)];
  }
  return accionDeBot(visto, color, { pesos: config.pesos, azar });
}

// Juega una partida completa. `porColor` asigna una configuración a cada color.
export function jugarPartida(porColor, semilla, limite = LIMITE_TURNOS) {
  const azar = generador(semilla);
  let estado = nuevaPartida(
    Object.fromEntries(COLORES.map((c) => [c, despliegueAleatorio(c, azar)])),
    { primero: COLORES[Math.floor(azar() * 4)] }
  );
  let turnos = 0;
  while (!estado.fin && turnos < limite) {
    if (estado.pendiente) {
      const p = estado.pendiente;
      if (p.tipo === "recoger") {
        estado = decisionDeRecogida(estado, p.color) ? recogerLaBandera(estado) : renunciarARecoger(estado);
      } else {
        estado = reclutar(estado, Math.max(...p.opciones));
      }
      continue;
    }
    const accion = jugadaDe(estado, estado.turno, porColor[estado.turno], azar);
    if (!accion) break;
    estado = aplicar(estado, accion);
    turnos++;
  }
  return { estado, turnos };
}

const [EQUIPO_A, EQUIPO_B] = EQUIPOS; // [rojo,azul] y [verde,amarillo]

// --- Recompensa cuando la partida no se decide -------------------------------
// Descubierto midiendo: dos configuraciones malas no rematan NUNCA. Ocho tablas
// de ocho, todas al tope de turnos. Con solo victoria o derrota, la fase de
// arranque a ciegas no tiene ninguna señal a la que agarrarse, que es el
// problema de la recompensa dispersa de manual.
//
// Así que una partida sin ganador no vale 0,5 a secas: se mira quién estaba
// más cerca de ganar. Es lo que el propio manual llama premiar el acercarse a
// la victoria, y es lo que da gradiente en las primeras generaciones.

function distanciaDeBanderaAlCastillo(estado, equipo) {
  let mejor = 40;
  for (const color of equipo) {
    const bandera = estado.banderas[color];
    if (!bandera) continue;
    let casilla = null;
    if (bandera.portador && estado.piezas[bandera.portador]) casilla = estado.piezas[bandera.portador].casilla;
    else if (bandera.casilla) casilla = bandera.casilla;
    if (!casilla) continue;
    const d = DISTANCIA[casilla];
    if (d !== undefined && d < mejor) mejor = d;
  }
  return mejor;
}

function materialDe(estado, equipo) {
  let total = 0;
  for (const p of Object.values(estado.piezas)) if (equipo.includes(p.color)) total += p.rango;
  return total;
}

function victoriasDe(estado, equipo) {
  return equipo.reduce((s, c) => s + (estado.marcador[c] || 0), 0);
}

// Devuelve entre 0 y 1 cuánto le corresponde al equipo A de una partida sin
// ganador: 0,5 si están igualados.
export function repartoDeTablas(estado) {
  const dA = distanciaDeBanderaAlCastillo(estado, EQUIPO_A);
  const dB = distanciaDeBanderaAlCastillo(estado, EQUIPO_B);
  const ventaja =
    0.30 * (dB - dA) +          // quién tiene su bandera más cerca de la torre
    0.02 * (materialDe(estado, EQUIPO_A) - materialDe(estado, EQUIPO_B)) +
    0.25 * (victoriasDe(estado, EQUIPO_A) - victoriasDe(estado, EQUIPO_B));
  return 0.5 + 0.5 * Math.tanh(ventaja / 3);
}

function repartir(configA, configB, invertido) {
  const primero = invertido ? configB : configA;
  const segundo = invertido ? configA : configB;
  const porColor = {};
  for (const c of EQUIPO_A) porColor[c] = primero;
  for (const c of EQUIPO_B) porColor[c] = segundo;
  return porColor;
}

// Enfrenta dos configuraciones en `parejas` emparejamientos. Cada emparejamiento
// son dos partidas con la misma semilla y los bandos cambiados.
// `limite` corta las partidas que no avanzan. En el entrenamiento importa
// mucho: dos configuraciones malas pueden no rematar nunca y una sola partida
// se come el tiempo de cuarenta. Se cuentan como tablas, que es lo que son.
export function enfrentar(configA, configB, parejas = 30, semillaBase = 1, limite = LIMITE_TURNOS) {
  const marcador = { a: 0, b: 0, tablas: 0, turnos: 0, partidas: 0, errores: 0, puntosA: 0 };
  for (let i = 0; i < parejas; i++) {
    const semilla = semillaBase + i * 7919;
    for (const invertido of [false, true]) {
      let resultado;
      try {
        resultado = jugarPartida(repartir(configA, configB, invertido), semilla, limite);
      } catch (e) {
        marcador.errores++;
        continue;
      }
      marcador.partidas++;
      marcador.turnos += resultado.turnos;
      const fin = resultado.estado.fin;
      if (!fin || !fin.ganador) {
        marcador.tablas++;
        // Sin ganador, el reparto lo decide quién estaba más cerca. Ojo con
        // `invertido`: el reparto se calcula sobre los bandos del tablero, y
        // hay que devolverlo a la perspectiva de la configuración A.
        const parteDelTablero = repartoDeTablas(resultado.estado);
        marcador.puntosA += invertido ? 1 - parteDelTablero : parteDelTablero;
        continue;
      }
      const ganoEquipoA = EQUIPO_A.includes(fin.ganador);
      const ganoA = ganoEquipoA !== invertido;
      if (ganoA) {
        marcador.a++;
        marcador.puntosA += 1;
      } else {
        marcador.b++;
      }
    }
  }
  const decididas = marcador.a + marcador.b;
  marcador.tasaA = decididas ? marcador.a / decididas : 0.5;
  // La puntuación sí cuenta las tablas, y es la que usa el entrenamiento.
  marcador.puntuacionA = marcador.partidas ? marcador.puntosA / marcador.partidas : 0.5;
  marcador.turnosMedia = marcador.partidas ? Math.round(marcador.turnos / marcador.partidas) : 0;
  return marcador;
}
