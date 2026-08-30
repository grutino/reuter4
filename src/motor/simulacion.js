// Banco de pruebas de los bots. Dos cosas distintas:
//
//   1. Salud: unas cuantas partidas completas para ver que nada se atasca ni revienta.
//   2. Duelo: bots con memoria contra bots clásicos, para medir si la memoria sirve.
//
// El duelo juega cada emparejamiento en las dos direcciones. Los bandos no son
// simétricos (rojo y azul entran por el norte y el sur, verde y amarillo por el
// este y el oeste) y quien empieza se sortea, así que sin alternar los papeles se
// estaría midiendo el tablero en vez de los bots.
//
// Uso: node src/motor/simulacion.js [partidasDeSalud] [partidasDeDuelo]

import { COLORES } from "./tablero.js";
import { nuevaPartida, aplicar, reclutar, EQUIPOS } from "./motor.js";
import { accionDeBot, accionDeBotClasico, despliegueAleatorio } from "./bot.js";

const LIMITE_TURNOS = 4000;

const [, , argSalud, argDuelo] = process.argv;
const PARTIDAS_SALUD = Number(argSalud) || 25;
const PARTIDAS_DUELO = Number(argDuelo) || 40;

// `estrategas` asocia cada color a la función que decide su jugada.
function jugarPartida(estrategas) {
  let estado = nuevaPartida(
    Object.fromEntries(COLORES.map((c) => [c, despliegueAleatorio(c)])),
    { primero: COLORES[Math.floor(Math.random() * 4)] }
  );
  let turnos = 0;
  while (!estado.fin && turnos < LIMITE_TURNOS) {
    if (estado.pendiente) {
      // El reclutamiento se resuelve igual para todos, para que la comparación
      // aísle la heurística de movimiento y no el criterio de recuperar piezas.
      estado = reclutar(estado, Math.max(...estado.pendiente.opciones));
      continue;
    }
    const accion = estrategas[estado.turno](estado, estado.turno);
    if (!accion) break;
    estado = aplicar(estado, accion);
    turnos++;
  }
  return { estado, turnos };
}

function mismoBot(fn) {
  return Object.fromEntries(COLORES.map((c) => [c, fn]));
}

// --- 1. Salud ----------------------------------------------------------------

function salud(partidas) {
  const resumen = { victorias: {}, turnos: [], sinGanador: 0, errores: 0 };
  for (let i = 0; i < partidas; i++) {
    try {
      const { estado, turnos } = jugarPartida(mismoBot(accionDeBot));
      resumen.turnos.push(turnos);
      if (estado.fin && estado.fin.ganador) {
        const clave = estado.fin.equipo.join("+");
        resumen.victorias[clave] = (resumen.victorias[clave] || 0) + 1;
      } else resumen.sinGanador++;
    } catch (e) {
      resumen.errores++;
      console.log("  error:", e.message);
    }
  }
  const media = Math.round(resumen.turnos.reduce((a, b) => a + b, 0) / (resumen.turnos.length || 1));
  console.log(`\n${partidas} partidas de bots con memoria`);
  console.log("  victorias por bando:", resumen.victorias);
  console.log("  sin ganador:", resumen.sinGanador, "| errores:", resumen.errores);
  console.log("  turnos: media", media, "| mínimo", Math.min(...resumen.turnos), "| máximo", Math.max(...resumen.turnos));
  return resumen.errores;
}

// --- 2. Duelo: memoria contra clásico ----------------------------------------

const [EQUIPO_A, EQUIPO_B] = EQUIPOS; // [rojo, azul] y [verde, amarillo]

function repartoDeBandos(memoriaEnA) {
  const estrategas = {};
  for (const c of EQUIPO_A) estrategas[c] = memoriaEnA ? accionDeBot : accionDeBotClasico;
  for (const c of EQUIPO_B) estrategas[c] = memoriaEnA ? accionDeBotClasico : accionDeBot;
  return estrategas;
}

function duelo(partidas) {
  const marcador = { memoria: 0, clasico: 0, tablas: 0, errores: 0 };
  const turnos = [];
  for (let i = 0; i < partidas; i++) {
    const memoriaEnA = i % 2 === 0; // se alternan los bandos partida sí, partida no
    try {
      const { estado, turnos: t } = jugarPartida(repartoDeBandos(memoriaEnA));
      turnos.push(t);
      if (!estado.fin || !estado.fin.ganador) {
        marcador.tablas++;
        continue;
      }
      const ganoA = EQUIPO_A.includes(estado.fin.ganador);
      const ganoLaMemoria = ganoA === memoriaEnA;
      marcador[ganoLaMemoria ? "memoria" : "clasico"]++;
    } catch (e) {
      marcador.errores++;
      console.log("  error:", e.message);
    }
  }
  const decididas = marcador.memoria + marcador.clasico;
  const porcentaje = decididas ? Math.round((marcador.memoria / decididas) * 100) : 0;
  const media = Math.round(turnos.reduce((a, b) => a + b, 0) / (turnos.length || 1));

  console.log(`\n${partidas} partidas: memoria contra clásico (bandos alternados)`);
  console.log("  gana la memoria:", marcador.memoria);
  console.log("  gana el clásico:", marcador.clasico);
  console.log("  tablas:", marcador.tablas, "| errores:", marcador.errores);
  console.log(`  sobre las ${decididas} partidas decididas, la memoria gana el ${porcentaje}%`);
  console.log("  turnos: media", media);
  return { porcentaje, decididas, errores: marcador.errores };
}

const erroresSalud = salud(PARTIDAS_SALUD);
const resultado = duelo(PARTIDAS_DUELO);

if (erroresSalud || resultado.errores) {
  console.log("\nHubo errores durante la simulación.\n");
  process.exit(1);
}
console.log("");
