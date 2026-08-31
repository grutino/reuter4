// Banco de escenarios: posiciones concretas donde se decide la partida.
//
// POR QUÉ. Los ejemplos salen hoy de partidas jugadas de principio a fin y se
// etiquetan con el resultado final, así que una jugada decisiva y una jugada
// intrascendente de la misma partida ganada reciben la MISMA etiqueta. Con eso
// se aprende lo que pasa mucho y no lo que pasa poco: medido sobre 3.420
// vectores, `tapaLineaAlAnillo` se activa en el 0,1% de los casos y
// `disparoAlCoronador` en ninguno. Un rasgo que aparece en el 0,2% de los
// ejemplos no aporta gradiente y la red lo ignora.
//
// Aquí se hace lo contrario: se guardan posiciones donde la cosa está en juego,
// y en cada una se prueban VARIAS jugadas de verdad, cada una hasta el final
// varias veces. Eso da una etiqueta por jugada -esta vale, esta no- en vez de
// una etiqueta por partida. Es la diferencia entre "ganamos, así que todo lo que
// hice estuvo bien" y "esta jugada concreta pierde".
//
// El banco crece y se guarda, así que los escenarios buenos se reutilizan entre
// entrenamientos en vez de tener que volver a tropezarse con ellos.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES, ANILLO, TORRE } from "../src/motor/tablero.js";
import {
  EQUIPOS, nuevaPartida, aplicar, movimientosLegales, reclutar,
  recogerLaBandera, renunciarARecoger, banderaQueCorona, CANON,
} from "../src/motor/motor.js";
import { accionDeBot, puntuarAcciones, decisionDeRecogida, despliegueAleatorio, DISTANCIA } from "../src/motor/bot.js";
import { analizarTurno } from "../src/motor/analisis.js";
import { rasgosDeJugada, contextoDeTurno } from "../src/motor/rasgos-jugada.js";
import { generador, repartoDeTablas } from "./arena.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const CARPETA = path.join(AQUI, "escenarios");
export const BANCO = path.join(CARPETA, "banco.json");
const [EQUIPO_A] = EQUIPOS;

// --- Qué posición merece entrar en el banco ----------------------------------
//
// No vale "cualquiera cerca del final": hace falta que la jugada de este turno
// pueda cambiar algo. Cada motivo es una situación donde eso pasa, y se guarda
// el motivo para poder mirar después si la red mejora en unas y no en otras.

export function motivoDeInteres(estado, color, analisis) {
  if (analisis.coronadorRival) return "coronador-rival";
  if (analisis.equipoAPuntoDeCoronar && analisis.lineasAlAnillo.length > 0) return "subir-con-canones";
  if (analisis.equipoAPuntoDeCoronar) return "subir-limpio";
  if (analisis.blancoEnLaTorre) return "torre-ocupada";

  const enAnillo = estado.tablero[ANILLO] ? estado.piezas[estado.tablero[ANILLO]] : null;
  if (enAnillo && enAnillo.color !== color) return "rival-en-el-anillo";

  // Un cañón mío en posición de batir el castillo: es lo raro que queremos que
  // la red vea muchas veces.
  for (const p of Object.values(estado.piezas)) {
    if (p.color !== color || p.rango !== CANON) continue;
    if (analisis.tapanElAnillo.size || (DISTANCIA[p.casilla] ?? 99) <= 3) return "canon-cerca";
  }
  return null;
}

// La firma de una posición son las CASILLAS ocupadas y de quién, no los ids de
// las piezas vivas: dos posiciones muy distintas pueden tener exactamente las
// mismas piezas en pie. Con la firma equivocada el banco descartaba 72 de 75
// escenarios creyéndolos repetidos.
export const firmaDePosicion = (estado) =>
  Object.values(estado.piezas)
    .map((p) => `${p.casilla}:${p.color}${p.bandera ? "*" : ""}`)
    .sort()
    .join("|");

// --- Recoger escenarios jugando ------------------------------------------------

const resolver = (estado) => {
  const p = estado.pendiente;
  return p.tipo === "recoger"
    ? decisionDeRecogida(estado, p.color) ? recogerLaBandera(estado) : renunciarARecoger(estado)
    : reclutar(estado, Math.max(...p.opciones));
};

export function recolectar({ partidas = 200, semilla = 1, limite = 400, jugar = null, porPartida = 3 } = {}) {
  const encontrados = [];
  const vistas = new Set();
  const mover = jugar || ((e, c, az) => accionDeBot(e, c, { azar: az }));

  for (let i = 0; i < partidas; i++) {
    const azar = generador(semilla + i * 7919);
    const despliegues = {};
    for (const color of COLORES) despliegues[color] = despliegueAleatorio(color, azar);
    let estado = nuevaPartida(despliegues, { primero: COLORES[Math.floor(azar() * 4)] });
    let turnos = 0;
    let deEsta = 0;

    while (!estado.fin && turnos < limite) {
      if (estado.pendiente) { estado = resolver(estado); continue; }
      const color = estado.turno;
      if (deEsta < porPartida) {
        const analisis = analizarTurno(estado, color, DISTANCIA);
        const motivo = motivoDeInteres(estado, color, analisis);
        if (motivo) {
          const f = firmaDePosicion(estado) + "#" + color;
          if (!vistas.has(f)) {
            vistas.add(f);
            // El estado se guarda entero: es JSON puro por invariante del motor,
            // así que el banco se puede escribir y volver a leer sin más.
            encontrados.push({ motivo, color, estado: JSON.parse(JSON.stringify(estado)) });
            deEsta++;
          }
        }
      }
      const accion = mover(estado, color, azar);
      if (!accion) break;
      estado = aplicar(estado, accion);
      turnos++;
    }
  }
  return encontrados;
}

// --- Etiquetar: qué vale cada jugada de verdad --------------------------------
//
// Se fuerza cada candidata y se juega hasta el final varias veces con distinta
// semilla. La etiqueta es lo que sale de ahí, no el resultado de la partida en
// la que apareció la posición.

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
  const fin = e.fin;
  const valorA = fin && fin.ganador ? (EQUIPO_A.includes(fin.ganador) ? 1 : 0) : repartoDeTablas(e);
  return EQUIPO_A.includes(color) ? valorA : 1 - valorA;
}

export function etiquetar(escenario, { candidatas = 6, tiradas = 3, limite = 200, jugar = null, semilla = 11 } = {}) {
  const { estado, color } = escenario;
  const mover = jugar || ((e, c, az) => accionDeBot(e, c, { azar: az }));
  const azar = generador(semilla);

  const puntuadas = puntuarAcciones(estado, color, { azar });
  if (puntuadas.length < 2) return null;

  // Las mejores según la heurística, más una del montón: sin alguna mala no hay
  // contraste, y aprender solo de jugadas razonables no enseña a descartar.
  const elegidas = puntuadas.slice(0, Math.min(candidatas - 1, puntuadas.length - 1)).map((p) => p.accion);
  elegidas.push(puntuadas[puntuadas.length - 1].accion);

  const salida = [];
  for (const accion of elegidas) {
    let suma = 0;
    for (let t = 0; t < tiradas; t++) {
      // Semillas comunes entre candidatas: la misma continuación para todas, así
      // la diferencia es la jugada y no la suerte del rollout.
      suma += jugarDesde(aplicar(estado, accion), color, mover, generador(semilla + t * 104729), limite);
    }
    salida.push({ accion, valor: suma / tiradas });
  }
  return salida;
}

// --- Pasar el banco a ejemplos de entrenamiento --------------------------------

export function ejemplosDeEscenario(escenario, evaluadas) {
  if (!evaluadas || evaluadas.length < 2) return [];
  const { estado, color } = escenario;
  const contexto = contextoDeTurno(estado, color, analizarTurno(estado, color, DISTANCIA));
  return evaluadas.map(({ accion, valor }) => ({
    entrada: rasgosDeJugada(estado, color, accion, contexto),
    objetivo: valor,
    motivo: escenario.motivo,
  }));
}

// --- El banco en disco ---------------------------------------------------------

export function leerBanco() {
  if (!fs.existsSync(BANCO)) return [];
  try {
    return JSON.parse(fs.readFileSync(BANCO, "utf8")).escenarios || [];
  } catch {
    return [];
  }
}

// Se guarda equilibrando motivos: sin eso, el banco se llena de la situación más
// común y vuelve a no haber ejemplos de las raras, que es justo el problema que
// esto viene a resolver.
export function guardarBanco(escenarios, tope = 600) {
  fs.mkdirSync(CARPETA, { recursive: true });
  const porMotivo = new Map();
  for (const e of escenarios) {
    if (!porMotivo.has(e.motivo)) porMotivo.set(e.motivo, []);
    porMotivo.get(e.motivo).push(e);
  }
  const cupo = Math.max(1, Math.floor(tope / Math.max(1, porMotivo.size)));
  const salida = [];
  for (const [, lista] of porMotivo) salida.push(...lista.slice(0, cupo));

  fs.writeFileSync(BANCO, JSON.stringify({ creado: new Date().toISOString(), escenarios: salida }, null, 1));
  return salida;
}

export function resumenDelBanco(escenarios) {
  const cuenta = {};
  for (const e of escenarios) cuenta[e.motivo] = (cuenta[e.motivo] || 0) + 1;
  return cuenta;
}
