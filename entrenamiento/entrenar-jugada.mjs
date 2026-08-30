// Entrena la red que evalúa jugadas, y con ella un bot que juega.
//
// Cada ejemplo es (posición + jugada) → ¿ganó al final quien la hizo? Con eso
// el gradiente reparte el crédito entre todos los rasgos de todas las jugadas
// de la partida, que es lo que hacía falta: no se gana por una jugada suelta
// sino por una cadena de decisiones, y el evolutivo solo veía el resultado de
// una configuración entera.
//
// Los datos se generan con exploración: una de cada cuatro veces se juega una
// candidata al azar en vez de la mejor. Sin eso solo se verían las jugadas que
// ya elige la heurística, y la red no tendría con qué comparar.
//
//   node entrenamiento/entrenar-jugada.mjs --partidas 800 --epocas 200

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES } from "../src/motor/tablero.js";
import {
  EQUIPOS, nuevaPartida, aplicar, reclutar, recogerLaBandera, renunciarARecoger,
} from "../src/motor/motor.js";
import {
  accionDeBot, puntuarAcciones, decisionDeRecogida, despliegueAleatorio, DISTANCIA, PESOS_BASE,
} from "../src/motor/bot.js";
import { analizarTurno } from "../src/motor/analisis.js";
import { generador, repartoDeTablas } from "./arena.mjs";
import { rasgosDeJugada, contextoDeTurno, TAMANO, NOMBRES } from "./rasgos-jugada.mjs";
import { crearRed, entrenarLote, evaluar, aObjeto, desdeObjeto } from "./red.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const [EQUIPO_A] = EQUIPOS;

function opciones(argv) {
  const o = {
    partidas: 800, epocas: 200, lote: 64, tasa: 0.006, oculta: 28, decaimiento: 0.0008,
    semilla: 1, limite: 400, candidatas: 12, exploracion: 0.25, medir: 80,
  };
  for (let i = 2; i < argv.length; i += 2) {
    const clave = argv[i].replace(/^--/, "");
    if (!(clave in o)) throw new Error(`opción desconocida: ${argv[i]}`);
    o[clave] = Number(argv[i + 1]);
  }
  return o;
}

const resolverPendiente = (estado) => {
  const p = estado.pendiente;
  return p.tipo === "recoger"
    ? decisionDeRecogida(estado, p.color) ? recogerLaBandera(estado) : renunciarARecoger(estado)
    : reclutar(estado, Math.max(...p.opciones));
};

// --- El bot que juega con la red ------------------------------------------------
// No hace falta aplicar la jugada para valorarla: los rasgos la describen. Eso
// evita clonar el estado doce veces por turno, que es lo que hacía inviable el
// intento anterior.

export function accionConRed(estado, color, red, { candidatas = 12, azar = Math.random, pesos = PESOS_BASE } = {}) {
  const puntuadas = puntuarAcciones(estado, color, { pesos, azar });
  if (!puntuadas.length) return null;
  const finalistas = puntuadas.slice(0, Math.min(candidatas, puntuadas.length));
  if (finalistas.length === 1) return finalistas[0].accion;

  const contexto = contextoDeTurno(estado, color, analizarTurno(estado, color, DISTANCIA));
  let mejor = finalistas[0].accion;
  let mejorValor = -Infinity;
  for (const { accion } of finalistas) {
    const valor = evaluar(red, rasgosDeJugada(estado, color, accion, contexto));
    if (valor > mejorValor) {
      mejorValor = valor;
      mejor = accion;
    }
  }
  return mejor;
}

// --- Datos -------------------------------------------------------------------------

function generarDatos(o) {
  const ejemplos = [];
  let decididas = 0;
  for (let i = 0; i < o.partidas; i++) {
    const azar = generador(o.semilla + i * 7919);
    let estado = nuevaPartida(
      Object.fromEntries(COLORES.map((c) => [c, despliegueAleatorio(c, azar)])),
      { primero: COLORES[Math.floor(azar() * 4)] }
    );
    const muestras = [];
    let turnos = 0;
    while (!estado.fin && turnos < o.limite) {
      if (estado.pendiente) {
        estado = resolverPendiente(estado);
        continue;
      }
      const color = estado.turno;
      const puntuadas = puntuarAcciones(estado, color, { azar });
      if (!puntuadas.length) break;
      const finalistas = puntuadas.slice(0, Math.min(o.candidatas, puntuadas.length));
      // Exploración: a veces una candidata al azar, para que la red vea también
      // jugadas que la heurística nunca elegiría.
      const elegida =
        azar() < o.exploracion
          ? finalistas[Math.floor(azar() * finalistas.length)].accion
          : finalistas[0].accion;

      const contexto = contextoDeTurno(estado, color, analizarTurno(estado, color, DISTANCIA));
      muestras.push({ entrada: rasgosDeJugada(estado, color, elegida, contexto), color });

      estado = aplicar(estado, elegida);
      turnos++;
    }
    const fin = estado.fin;
    let valorA;
    if (fin && fin.ganador) {
      valorA = EQUIPO_A.includes(fin.ganador) ? 1 : 0;
      decididas++;
    } else {
      valorA = repartoDeTablas(estado);
    }
    for (const m of muestras) {
      ejemplos.push({ entrada: m.entrada, objetivo: EQUIPO_A.includes(m.color) ? valorA : 1 - valorA });
    }
  }
  return { ejemplos, decididas };
}

// --- Medida en juego ------------------------------------------------------------------

function medirEnJuego(red, parejas, o, semillaBase) {
  let gana = 0;
  let pierde = 0;
  let tablas = 0;
  for (let i = 0; i < parejas; i++) {
    for (const invertido of [false, true]) {
      const azar = generador(semillaBase + i * 7919);
      let estado = nuevaPartida(
        Object.fromEntries(COLORES.map((c) => [c, despliegueAleatorio(c, azar)])),
        { primero: COLORES[Math.floor(azar() * 4)] }
      );
      let turnos = 0;
      while (!estado.fin && turnos < o.limite) {
        if (estado.pendiente) {
          estado = resolverPendiente(estado);
          continue;
        }
        const color = estado.turno;
        const usaLaRed = EQUIPO_A.includes(color) !== invertido;
        const accion = usaLaRed
          ? accionConRed(estado, color, red, { candidatas: o.candidatas, azar })
          : accionDeBot(estado, color, { azar });
        if (!accion) break;
        estado = aplicar(estado, accion);
        turnos++;
      }
      const fin = estado.fin;
      if (!fin || !fin.ganador) tablas++;
      else if (EQUIPO_A.includes(fin.ganador) !== invertido) gana++;
      else pierde++;
    }
  }
  const n = gana + pierde;
  return { gana, pierde, tablas, tasa: n ? gana / n : 0.5, error: Math.sqrt(0.25 / Math.max(1, n)) };
}

// --- Principal ----------------------------------------------------------------------------

async function main() {
  const o = opciones(process.argv);
  const azar = generador(o.semilla);
  console.log("Entrenamiento del evaluador de jugadas\n");

  console.log(`  Jugando ${o.partidas} partidas con ${Math.round(o.exploracion * 100)}% de exploración...`);
  const t0 = Date.now();
  const { ejemplos, decididas } = generarDatos(o);
  console.log(`  ${ejemplos.length} jugadas en ${Math.round((Date.now() - t0) / 1000)}s · partidas decididas ${decididas}\n`);

  const barajado = ejemplos.slice();
  for (let i = barajado.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [barajado[i], barajado[j]] = [barajado[j], barajado[i]];
  }
  const corte = Math.floor(barajado.length * 0.75);
  const entrenamiento = barajado.slice(0, corte);
  const validacion = barajado.slice(corte);

  const perdidaDe = (red, conjunto) => {
    let s = 0;
    for (const ej of conjunto) {
      const p = evaluar(red, ej.entrada);
      s += -(ej.objetivo * Math.log(p + 1e-9) + (1 - ej.objetivo) * Math.log(1 - p + 1e-9));
    }
    return s / conjunto.length;
  };

  const red = crearRed([TAMANO, o.oculta, 1], azar);
  console.log(`  Red ${TAMANO}-${o.oculta}-1 · ${entrenamiento.length} de entrenamiento, ${validacion.length} de validación`);
  console.log(`  pérdida de partida ${perdidaDe(red, validacion).toFixed(4)}  (a ciegas ≈ 0.693)\n`);

  let mejor = Infinity;
  let mejorPesos = aObjeto(red);
  const curva = [];
  for (let epoca = 1; epoca <= o.epocas; epoca++) {
    for (let i = 0; i < entrenamiento.length; i += o.lote) {
      entrenarLote(red, entrenamiento.slice(i, i + o.lote), { tasa: o.tasa, decaimiento: o.decaimiento });
    }
    if (epoca % 5 === 0 || epoca === o.epocas) {
      const pEnt = perdidaDe(red, entrenamiento);
      const pVal = perdidaDe(red, validacion);
      curva.push({ epoca, entrenamiento: Number(pEnt.toFixed(5)), validacion: Number(pVal.toFixed(5)) });
      if (pVal < mejor) {
        mejor = pVal;
        mejorPesos = aObjeto(red);
      }
      if (epoca % 40 === 0) console.log(`  época ${String(epoca).padStart(4)}  entrenamiento ${pEnt.toFixed(4)}  validación ${pVal.toFixed(4)}`);
    }
  }
  console.log(`\n  Mejor pérdida de validación: ${mejor.toFixed(4)}`);

  const redBuena = desdeObjeto(mejorPesos);
  const cubos = Array.from({ length: 10 }, () => ({ n: 0, suma: 0, real: 0 }));
  let aciertos = 0;
  for (const ej of validacion) {
    const p = evaluar(redBuena, ej.entrada);
    const c = cubos[Math.min(9, Math.floor(p * 10))];
    c.n++; c.suma += p; c.real += ej.objetivo;
    if ((p > 0.5 ? 1 : 0) === (ej.objetivo > 0.5 ? 1 : 0)) aciertos++;
  }
  const calibracion = cubos.filter((c) => c.n).map((c) => ({ n: c.n, predicho: c.suma / c.n, real: c.real / c.n }));
  console.log(`  Acierto en validación: ${((aciertos / validacion.length) * 100).toFixed(1)}%`);

  console.log(`\n  Midiendo en juego: la red contra la heurística sola...`);
  const t1 = Date.now();
  const medida = medirEnJuego(redBuena, o.medir, o, 909090);
  console.log(
    `  ${medida.gana}-${medida.pierde} (tablas ${medida.tablas}) = ${(medida.tasa * 100).toFixed(0)}% ±${Math.round(medida.error * 100)} en ${Math.round((Date.now() - t1) / 1000)}s`
  );

  const salida = path.join(AQUI, "modelos", "red-jugada.json");
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, JSON.stringify({
    creado: new Date().toISOString(), opciones: o, perdidaValidacion: mejor,
    acierto: aciertos / validacion.length, victoriasEnJuego: medida.tasa, errorEnJuego: medida.error,
    nombres: NOMBRES, calibracion, curva, red: mejorPesos,
  }, null, 2));
  console.log(`\n  Guardado en ${path.relative(process.cwd(), salida)}`);
}

if (process.argv[1] && process.argv[1].endsWith("entrenar-jugada.mjs")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
