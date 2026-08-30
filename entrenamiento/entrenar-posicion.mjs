// Entrena la red de valoración de posición, y con ella un bot que juega.
//
// El procedimiento: se juegan miles de partidas, se guardan posiciones sueltas
// con quién acabó ganando, y la red aprende a estimar esa probabilidad. Después,
// jugar es mirar la posición que deja cada jugada candidata y quedarse con la
// mejor valorada.
//
// Esto es lo que resuelve el problema que planteaba el usuario: no se gana por
// una jugada buena suelta, sino por una cadena de decisiones. El evolutivo solo
// veía el resultado final de una configuración entera; aquí cada posición de
// cada partida es un ejemplo, y el gradiente reparte el crédito entre todos los
// rasgos a la vez.
//
// Por qué la heurística sigue en medio: valorar las cien jugadas legales con la
// red obligaría a clonar el estado cien veces por turno, y `aplicar` hace una
// copia JSON completa del tablero. Se filtra con la heurística —que es barata—
// y la red solo juzga las mejores. Propone una, dispone la otra.
//
//   node entrenamiento/entrenar-posicion.mjs --partidas 1200 --epocas 250

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES } from "../src/motor/tablero.js";
import {
  EQUIPOS,
  nuevaPartida,
  aplicar,
  movimientosLegales,
  reclutar,
  recogerLaBandera,
  renunciarARecoger,
} from "../src/motor/motor.js";
import { accionDeBot, puntuarAcciones, decisionDeRecogida, despliegueAleatorio, PESOS_BASE } from "../src/motor/bot.js";
import { generador, repartoDeTablas } from "./arena.mjs";
import { rasgosDePosicion, TAMANO, NOMBRES } from "../src/motor/rasgos-posicion.js";
import { crearRed, entrenarLote, evaluar, aObjeto, desdeObjeto } from "./red.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const [EQUIPO_A] = EQUIPOS;

function opciones(argv) {
  const o = {
    partidas: 1200, epocas: 250, lote: 64, tasa: 0.008, oculta: 20, decaimiento: 0.001,
    semilla: 1, limite: 400, cada: 6, candidatas: 12, medir: 80,
  };
  for (let i = 2; i < argv.length; i += 2) {
    const clave = argv[i].replace(/^--/, "");
    if (!(clave in o)) throw new Error(`opción desconocida: ${argv[i]}`);
    o[clave] = Number(argv[i + 1]);
  }
  return o;
}

function resolverPendiente(estado) {
  const p = estado.pendiente;
  return p.tipo === "recoger"
    ? decisionDeRecogida(estado, p.color)
      ? recogerLaBandera(estado)
      : renunciarARecoger(estado)
    : reclutar(estado, Math.max(...p.opciones));
}

// --- Bot que juega con la red -------------------------------------------------
// La heurística ordena y la red elige entre las mejores.

export function accionConRed(estado, color, red, { candidatas = 12, azar = Math.random, pesos = PESOS_BASE } = {}) {
  // La heurística de verdad ordena las jugadas. El primer intento usaba un
  // atajo casero para esto y hundía al bot al 21%: la red elegía la mejor de
  // una lista mala.
  const puntuadas = puntuarAcciones(estado, color, { pesos, azar });
  if (!puntuadas.length) return null;
  const finalistas = puntuadas.slice(0, Math.min(candidatas, puntuadas.length));
  if (finalistas.length === 1) return finalistas[0].accion;

  let mejor = finalistas[0].accion;
  let mejorValor = -Infinity;
  for (const { accion } of finalistas) {
    let despues;
    try {
      despues = aplicar(estado, accion);
    } catch (e) {
      continue;
    }
    const valor = evaluar(red, rasgosDePosicion(despues, color));
    if (valor > mejorValor) {
      mejorValor = valor;
      mejor = accion;
    }
  }
  return mejor;
}

// --- Datos ---------------------------------------------------------------------

function generarDatos(partidas, semilla, limite, cada) {
  const ejemplos = [];
  let decididas = 0;
  for (let i = 0; i < partidas; i++) {
    const azar = generador(semilla + i * 7919);
    let estado = nuevaPartida(
      Object.fromEntries(COLORES.map((c) => [c, despliegueAleatorio(c, azar)])),
      { primero: COLORES[Math.floor(azar() * 4)] }
    );
    const muestras = [];
    let turnos = 0;
    while (!estado.fin && turnos < limite) {
      if (estado.pendiente) {
        estado = resolverPendiente(estado);
        continue;
      }
      if (turnos % cada === 0) {
        // Se muestrea desde los CUATRO colores, no solo desde el que mueve. Si
        // no, la red solo ve posiciones "me toca a mí" y luego se le pregunta
        // por posiciones "acabo de mover", que es otra distribución.
        for (const color of COLORES) muestras.push({ entrada: rasgosDePosicion(estado, color), color });
      }
      const accion = accionDeBot(estado, estado.turno, { azar });
      if (!accion) break;
      estado = aplicar(estado, accion);
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

// --- Medida en juego -------------------------------------------------------------

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
      if (!fin || !fin.ganador) {
        tablas++;
        continue;
      }
      if (EQUIPO_A.includes(fin.ganador) !== invertido) gana++;
      else pierde++;
    }
  }
  return { gana, pierde, tablas, tasa: gana + pierde ? gana / (gana + pierde) : 0.5 };
}

// --- Principal ---------------------------------------------------------------------

async function main() {
  const o = opciones(process.argv);
  const azar = generador(o.semilla);
  console.log("Entrenamiento de la valoración de posición\n");

  console.log(`  Jugando ${o.partidas} partidas y muestreando 1 de cada ${o.cada} jugadas...`);
  const t0 = Date.now();
  const { ejemplos, decididas } = generarDatos(o.partidas, o.semilla, o.limite, o.cada);
  console.log(`  ${ejemplos.length} posiciones en ${Math.round((Date.now() - t0) / 1000)}s · partidas decididas ${decididas}\n`);

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
      if (epoca % 50 === 0) console.log(`  época ${String(epoca).padStart(4)}  entrenamiento ${pEnt.toFixed(4)}  validación ${pVal.toFixed(4)}`);
    }
  }
  console.log(`\n  Mejor pérdida de validación: ${mejor.toFixed(4)}`);

  const redBuena = desdeObjeto(mejorPesos);

  // Calibración y discriminación, que es lo que dice si la red vale para algo
  // más allá de la pérdida.
  const cubos = Array.from({ length: 10 }, () => ({ n: 0, suma: 0, real: 0 }));
  let aciertos = 0;
  for (const ej of validacion) {
    const p = evaluar(redBuena, ej.entrada);
    const c = cubos[Math.min(9, Math.floor(p * 10))];
    c.n++;
    c.suma += p;
    c.real += ej.objetivo;
    if ((p > 0.5 ? 1 : 0) === (ej.objetivo > 0.5 ? 1 : 0)) aciertos++;
  }
  const calibracion = cubos.filter((c) => c.n).map((c) => ({ n: c.n, predicho: c.suma / c.n, real: c.real / c.n }));
  console.log(`  Acierto en validación: ${((aciertos / validacion.length) * 100).toFixed(1)}%`);

  console.log(`\n  Midiendo en juego: red contra la heurística sola...`);
  const t1 = Date.now();
  const medida = medirEnJuego(redBuena, o.medir, o, 909090);
  const n = medida.gana + medida.pierde;
  console.log(
    `  ${medida.gana}-${medida.pierde} (tablas ${medida.tablas}) = ${(medida.tasa * 100).toFixed(0)}% ±${Math.round(100 * Math.sqrt(0.25 / Math.max(1, n)))} en ${Math.round((Date.now() - t1) / 1000)}s`
  );

  const salida = path.join(AQUI, "modelos", "red-posicion.json");
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(
    salida,
    JSON.stringify(
      { creado: new Date().toISOString(), opciones: o, perdidaValidacion: mejor, acierto: aciertos / validacion.length,
        victoriasEnJuego: medida.tasa, nombres: NOMBRES, calibracion, curva, red: mejorPesos },
      null, 2
    )
  );
  console.log(`\n  Guardado en ${path.relative(process.cwd(), salida)}`);
}

if (process.argv[1] && process.argv[1].endsWith("entrenar-posicion.mjs")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
