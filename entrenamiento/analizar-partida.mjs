// Qué jugadas decidieron una partida.
//
// DOS ETAPAS, porque la buena es cara. La red evalúa todas las jugadas legales
// de cada posición —eso son microsegundos— y marca dónde la jugada que se hizo
// se aleja mucho de la que ella habría elegido. Solo en esos puntos se hace lo
// caro: jugar de verdad, varias veces, la jugada que se hizo y la alternativa,
// y ver si el resultado cambia.
//
// La diferencia entre las dos etapas importa: la primera dice "aquí la red no
// habría hecho eso", que puede ser un error de la red; la segunda lo mide en la
// moneda del juego. Un momento solo cuenta como decisivo si la segunda etapa lo
// confirma.
//
//   node entrenamiento/analizar-partida.mjs --simular 1
//   node entrenamiento/analizar-partida.mjs --sala <id>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES } from "../src/motor/tablero.js";
import { EQUIPOS, movimientosLegales, aplicar, reclutar, recogerLaBandera, renunciarARecoger, nuevaPartida } from "../src/motor/motor.js";
import { accionDeBot, decisionDeRecogida, despliegueAleatorio, DISTANCIA } from "../src/motor/bot.js";
import { cargarModelos, jugadaSoloRed } from "../src/motor/bot-red.js";
import { evaluar } from "../src/motor/red.js";
import { analizarTurno } from "../src/motor/analisis.js";
import { rasgosDeJugada, contextoDeTurno } from "../src/motor/rasgos-jugada.js";
import { reproducirPartida } from "../src/motor/replay.js";
import { generador, repartoDeTablas } from "./arena.mjs";
import { NOMBRE_RANGO } from "../src/estilo.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const [EQUIPO_A] = EQUIPOS;

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

const resolver = (estado) => {
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

// --- Guion --------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith("analizar-partida.mjs")) {
  const modelos = cargarModelos();
  if (!modelos.jugada) {
    console.error("Hace falta una red de jugada publicada: npm run publicar-redes");
    process.exit(1);
  }
  // Las tiradas llevan ruido a propósito: con una política determinista, pedir
  // varias calcula varias veces lo mismo.
  const jugar = (e, c, az) => jugadaSoloRed(e, c, modelos.jugada, { azar: az, ruido: 0.2 });

  const arg = (nombre, def) => {
    const i = process.argv.indexOf(`--${nombre}`);
    return i >= 0 ? process.argv[i + 1] : def;
  };

  let despliegues;
  let historia;
  const idSala = arg("sala", null);
  if (idSala) {
    const fichero = process.env.R4_ESTADO || path.join(AQUI, "..", "servidor", "salas.json");
    const salas = JSON.parse(fs.readFileSync(fichero, "utf8"));
    const sala = salas[idSala] || Object.values(salas).find((s) => s.id === idSala);
    if (!sala) { console.error(`No hay ninguna sala ${idSala} en ${fichero}`); process.exit(1); }
    if (!sala.estado || !sala.estado.fin) { console.error("Esa partida no ha terminado."); process.exit(1); }
    despliegues = sala.despliegues;
    historia = sala.estado.historia;
    console.log(`Partida "${sala.nombre}" · ${historia.length} jugadas\n`);
  } else {
    // Una partida jugada al momento, para poder probar esto sin sala guardada.
    const semilla = Number(arg("simular", 1));
    const azar = generador(9100 + semilla * 7919);
    despliegues = {};
    for (const c of COLORES) despliegues[c] = despliegueAleatorio(c, azar);
    let e = nuevaPartida(despliegues, { primero: COLORES[Math.floor(azar() * 4)] });
    let t = 0;
    while (!e.fin && t < 400) {
      if (e.pendiente) { e = resolver(e); continue; }
      const a = accionDeBot(e, e.turno, { azar });
      if (!a) break;
      e = aplicar(e, a);
      t++;
    }
    historia = e.historia;
    console.log(`Partida simulada · ${historia.length} jugadas · ${e.fin && e.fin.ganador ? `gana ${e.fin.ganador}` : "sin ganador"}\n`);
  }

  const t0 = Date.now();
  const momentos = analizarPartida(despliegues, historia, {
    red: modelos.jugada, jugar,
    cuantos: Number(arg("cuantos", 8)), tiradas: Number(arg("tiradas", 12)),
  });

  console.log("  Momentos donde la partida se decidió, de más a menos:");
  console.log("  (medir esto es ruidoso: la misma posición medida dos veces con 8 tiradas");
  console.log("   solo correlaciona 0,39 consigo misma, así que fíate de los que superan su error)\n");
  for (const m of momentos) {
    const d = describir(m);
    const signo = m.medido > 0 ? "-" : "+";
    console.log(`  jugada ${String(m.n).padStart(3)} · ${m.color}`);
    console.log(`     hizo:      ${d.jugada}`);
    console.log(`     mejor:     ${d.alternativa}`);
    const claro = Math.abs(m.medido) > 2 * m.error ? "" : "   (dentro del ruido)";
    console.log(`     medido:    ${(m.valorJugada * 100).toFixed(0)}% contra ${(m.valorAlternativa * 100).toFixed(0)}%  ` +
      `(${signo}${Math.abs(m.medido * 100).toFixed(0)} ±${Math.round(m.error * 100)} puntos)${claro}`);
  }
  console.log(`\n  ${Math.round((Date.now() - t0) / 1000)}s`);
}
