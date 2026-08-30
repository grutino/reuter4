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
import { rasgosDeJugada, contextoDeTurno, TAMANO, NOMBRES } from "../src/motor/rasgos-jugada.js";
import { crearRed, entrenarLote, evaluar, aObjeto, desdeObjeto } from "./red.mjs";
import { accionConRed } from "../src/motor/bot-red.js";
export { accionConRed };

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const [EQUIPO_A] = EQUIPOS;

function opciones(argv) {
  const o = {
    partidas: 800, epocas: 200, lote: 64, tasa: 0.006, oculta: 28, decaimiento: 0.0008,
    semilla: 1, limite: 400, candidatas: 12, exploracion: 0.25, medir: 80, rondas: 1,
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


// --- Datos -------------------------------------------------------------------------

// `guia` es la red con la que se juega para generar los datos. En la primera
// ronda no hay ninguna y juega la heurística; en las siguientes juega la red
// de la ronda anterior. Sin esto la red solo aprende a imitar a su maestro y se
// queda clavada en su nivel, que es lo que pasó midiendo 46% ronda tras ronda.
function generarDatos(o, guia = null) {
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
      const contexto = contextoDeTurno(estado, color, analizarTurno(estado, color, DISTANCIA));
      let elegida;
      if (azar() < o.exploracion) {
        elegida = finalistas[Math.floor(azar() * finalistas.length)].accion;
      } else if (guia) {
        let mejorValor = -Infinity;
        elegida = finalistas[0].accion;
        for (const { accion } of finalistas) {
          const valor = evaluar(guia, rasgosDeJugada(estado, color, accion, contexto));
          if (valor > mejorValor) { mejorValor = valor; elegida = accion; }
        }
      } else {
        elegida = finalistas[0].accion;
      }
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
  console.log(`  ${o.rondas} ronda(s) · ${o.partidas} partidas por ronda · ${Math.round(o.exploracion * 100)}% de exploración\n`);

  const perdidaDe = (red, conjunto) => {
    let s = 0;
    for (const ej of conjunto) {
      const p = evaluar(red, ej.entrada);
      s += -(ej.objetivo * Math.log(p + 1e-9) + (1 - ej.objetivo) * Math.log(1 - p + 1e-9));
    }
    return s / conjunto.length;
  };

  let guia = null;
  const rondas = [];
  let mejorPesosGlobal = null;
  let mejorVictorias = -1;

  for (let ronda = 1; ronda <= o.rondas; ronda++) {
    console.log(`--- Ronda ${ronda} de ${o.rondas} ---`);
    const t0 = Date.now();
    const { ejemplos, decididas } = generarDatos({ ...o, semilla: o.semilla + ronda * 104729 }, guia);
    console.log(`  ${ejemplos.length} jugadas en ${Math.round((Date.now() - t0) / 1000)}s · decididas ${decididas}`);

    const barajado = ejemplos.slice();
    for (let i = barajado.length - 1; i > 0; i--) {
      const j = Math.floor(azar() * (i + 1));
      [barajado[i], barajado[j]] = [barajado[j], barajado[i]];
    }
    const corte = Math.floor(barajado.length * 0.75);
    const entrenamiento = barajado.slice(0, corte);
    const validacion = barajado.slice(corte);

    // Cada ronda empieza de cero: reaprovechar la red anterior la ancla a los
    // datos viejos, que son justo los que se quieren superar.
    const red = crearRed([TAMANO, o.oculta, 1], azar);
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
        if (pVal < mejor) { mejor = pVal; mejorPesos = aObjeto(red); }
      }
    }

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
    const medida = medirEnJuego(redBuena, o.medir, o, 909090);
    console.log(
      `  validación ${mejor.toFixed(4)} · acierto ${((aciertos / validacion.length) * 100).toFixed(1)}% · ` +
      `en juego ${medida.gana}-${medida.pierde} = ${(medida.tasa * 100).toFixed(0)}% ±${Math.round(medida.error * 100)}\n`
    );

    rondas.push({
      ronda, ejemplos: ejemplos.length, perdidaValidacion: mejor, acierto: aciertos / validacion.length,
      victoriasEnJuego: medida.tasa, errorEnJuego: medida.error, tablas: medida.tablas, calibracion, curva,
    });
    if (medida.tasa > mejorVictorias) { mejorVictorias = medida.tasa; mejorPesosGlobal = mejorPesos; }
    guia = redBuena;
  }

  console.log(`  Mejor de todas las rondas: ${(mejorVictorias * 100).toFixed(0)}% de victorias`);

  const salida = path.join(AQUI, "modelos", "red-jugada.json");
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, JSON.stringify({
    creado: new Date().toISOString(), opciones: o, nombres: NOMBRES,
    mejorVictorias, rondas, red: mejorPesosGlobal,
  }, null, 2));
  console.log(`  Guardado en ${path.relative(process.cwd(), salida)}`);
}

if (process.argv[1] && process.argv[1].endsWith("entrenar-jugada.mjs")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
