// Qué jugadas decidieron una partida.
//
// Vive en el motor y no en `entrenamiento/` porque lo ejecuta el informe de fin
// de partida, que corre en el navegador. No usa nada de Node.
//
// DOS ETAPAS, porque la buena es cara. La red evalúa todas las jugadas legales de
// cada posición —microsegundos— y marca dónde la jugada que se hizo se aparta de
// la que ella habría elegido. Solo en esos puntos se hace lo caro: jugar de
// verdad, varias veces, la jugada que se hizo y la alternativa.
//
// Y UN AVISO QUE VA CON CADA NÚMERO QUE SALE DE AQUÍ: medir el impacto de una
// jugada suelta es muy ruidoso. La misma posición medida dos veces con 8 tiradas
// solo correlaciona 0,39 consigo misma, y las dos medidas difieren de media 5
// puntos sobre un recorrido de 35. Por eso `verificar` devuelve el error junto a
// la diferencia: sin él, el listado parece decir cosas que no dice.
//
// Eso también explica por qué la etapa 1 no filtra bien —ninguna señal barata
// puede predecir mejor de lo que la medida se predice a sí misma— así que sirve
// para acotar el trabajo, no para ordenar por importancia.

import { EQUIPOS, movimientosLegales, aplicar, reclutar, recogerLaBandera, renunciarARecoger } from "./motor.js";
import { decisionDeRecogida, DISTANCIA } from "./bot.js";
import { evaluar } from "./red.js";
import { analizarTurno } from "./analisis.js";
import { rasgosDeJugada, contextoDeTurno } from "./rasgos-jugada.js";
import { reproducirPartida } from "./replay.js";
import { repartoDeTablas } from "./valoracion.js";
import { NOMBRE_RANGO } from "../estilo.js";

const [EQUIPO_A] = EQUIPOS;

// mulberry32, el mismo de la arena: las tiradas necesitan azar sembrado para que
// las dos ramas compartan continuación.
function generador(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Etapa 1: dónde se apartó de lo que la red habría hecho -------------------

export function sospechosos(pasos, red, { cuantos = 8 } = {}) {
  const salida = [];
  for (const paso of pasos) {
    if (!paso.accion) continue;
    const { estado, color, accion } = paso;
    const legales = movimientosLegales(estado, color);
    if (legales.length < 3) continue;

    const contexto = contextoDeTurno(estado, color, analizarTurno(estado, color, DISTANCIA));
    let mejor = null;
    let mejorNota = -Infinity;
    let notaJugada = null;
    for (const a of legales) {
      const nota = evaluar(red, rasgosDeJugada(estado, color, a, contexto));
      if (nota > mejorNota) { mejorNota = nota; mejor = a; }
      if (a.tipo === accion.tipo && a.desde === accion.desde && a.hasta === accion.hasta) notaJugada = nota;
    }
    if (notaJugada === null) continue;
    salida.push({ ...paso, alternativa: mejor, sospecha: mejorNota - notaJugada, notaJugada, mejorNota });
  }
  salida.sort((a, b) => b.sospecha - a.sospecha);
  return salida.slice(0, cuantos);
}

// --- Etapa 2: jugarlo de verdad ------------------------------------------------

export const resolver = (estado) => {
  const p = estado.pendiente;
  return p.tipo === "recoger"
    ? decisionDeRecogida(estado, p.color) ? recogerLaBandera(estado) : renunciarARecoger(estado)
    : reclutar(estado, Math.max(...p.opciones));
};

function jugarDesde(estado, color, jugar, azar, limite) {
  let e = estado;
  let turnos = 0;
  while (!e.fin && turnos < limite) {
    if (e.pendiente) { e = resolver(e); continue; }
    const a = jugar(e, e.turno, azar);
    if (!a) break;
    e = aplicar(e, a);
    turnos++;
  }
  const valorA = e.fin && e.fin.ganador ? (EQUIPO_A.includes(e.fin.ganador) ? 1 : 0) : repartoDeTablas(e);
  return EQUIPO_A.includes(color) ? valorA : 1 - valorA;
}

// OJO CON EL DETERMINISMO DE LAS TIRADAS, que casi me hace concluir lo contrario
// de lo que pasa. Una política sin ruido juega SIEMPRE la misma continuación, así
// que pedir tres tiradas calcula tres veces lo mismo: dos medidas de la misma
// posición con semillas distintas daban correlación 1,000 y diferencia 0. La
// política de las tiradas tiene que ser estocástica para que promediar signifique
// algo — es la diferencia entre "cuánto vale esta jugada" y "qué pasó una vez".
export function verificar(momento, jugar, { tiradas = 12, limite = 200, semilla = 5 } = {}) {
  const valorDe = (accion) => {
    const tirada = [];
    for (let t = 0; t < tiradas; t++) {
      // Semillas comunes entre las dos ramas: la diferencia es la jugada, no la
      // suerte de la continuación.
      tirada.push(jugarDesde(aplicar(momento.estado, accion), momento.color, jugar, generador(semilla + t * 104729), limite));
    }
    const media = tirada.reduce((a, b) => a + b, 0) / tirada.length;
    const varianza = tirada.reduce((s, v) => s + (v - media) ** 2, 0) / Math.max(1, tirada.length - 1);
    return { media, error: Math.sqrt(varianza / tirada.length) };
  };
  const jugada = valorDe(momento.accion);
  const otra = valorDe(momento.alternativa);
  // El error va con el número: medida sin él, esta diferencia engaña. Con 8
  // tiradas, dos medidas de la MISMA posición solo correlacionan 0,39.
  return {
    ...momento,
    valorJugada: jugada.media, valorAlternativa: otra.media,
    medido: otra.media - jugada.media,
    error: Math.sqrt(jugada.error ** 2 + otra.error ** 2),
  };
}

// --- Ponerlo bonito ------------------------------------------------------------

const CASILLA = (c) => (c === "ANILLO" ? "anillo" : c === "TORRE" ? "torre" : c);

export function describir(momento) {
  const pieza = momento.estado.piezas[momento.accion.pieza];
  const quien = pieza ? NOMBRE_RANGO[pieza.rango] : "una pieza";
  const verbo = (a) => (a.tipo === "disparar" ? "dispara a" : a.tipo === "atacar" ? "ataca" : "va a");
  return {
    jugada: `el ${quien} de ${CASILLA(momento.accion.desde)} ${verbo(momento.accion)} ${CASILLA(momento.accion.hasta)}`,
    alternativa: `${CASILLA(momento.alternativa.desde)} ${verbo(momento.alternativa)} ${CASILLA(momento.alternativa.hasta)}`,
  };
}

export function analizarPartida(despliegues, historia, { red, jugar, cuantos = 8, tiradas = 12, limite = 200 } = {}) {
  const { pasos } = reproducirPartida(despliegues, historia);
  const candidatos = sospechosos(pasos, red, { cuantos });
  return candidatos
    .map((m) => verificar(m, jugar, { tiradas, limite }))
    .sort((a, b) => Math.abs(b.medido) - Math.abs(a.medido));
}

