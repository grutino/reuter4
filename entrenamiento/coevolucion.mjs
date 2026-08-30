// Coevolución: las dos redes juegan entre ellas y aprenden de esas partidas.
//
// Hasta aquí cada red se entrenaba con partidas jugadas por la heurística, así
// que aprendía a predecir el resultado de un juego que no era el suyo. Con eso
// se llega al nivel del maestro y poco más. Aquí las partidas las juegan las
// propias redes: la de despliegue monta la posición y la de jugada decide cada
// movimiento, y de ahí salen los ejemplos con los que ambas se reentrenan.
//
// LAS TRES COSAS QUE HAY QUE HACER BIEN, aprendidas rompiéndolas:
//
// 1. NO ENTRENAR DESDE CERO CADA RONDA. El primer intento rehacía las redes con
//    las 300 partidas de la ronda, cuando venían de 4000. Las cinco rondas
//    salieron peores y parecía que la coevolución no servía; lo que medía era el
//    tamaño del conjunto de datos. Ahora se continúa desde los pesos vigentes y
//    se guarda la mejor validación incluyendo el punto de partida, así que la
//    ronda solo puede mantener o mejorar.
//
// 2. NO JUGAR SOLO CONTRA UNO MISMO. Aquel intento hacía desplegar a los cuatro
//    colores con la red, así que los ejemplos solo contenían posiciones que la
//    red ya prefería. El panel son aperturas humanas: dejaba de verlas y las
//    olvidaba. `humana-02` se desplomó al 0%, no por ser imbatible sino por
//    haberse vuelto desconocida. Ahora una parte de las partidas son de liga,
//    contra la mezcla de aperturas y la heurística.
//
// 3. NO REPETIR PARTIDA. Sin ruido, dos redes que ya se parecen generan siempre
//    lo mismo. Las jugadas llevan exploración y los despliegues, recocido.
//
// Y la vara no se mueve: cada ronda se mide contra el panel, que no cambia, y
// solo se adopta si sube. Las redes juegan entre ellas pero se puntúan contra
// algo externo, así que "mejorar" no puede degenerar en "cambiar".
//
//   node entrenamiento/coevolucion.mjs --rondas 6 --partidas 400

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES } from "../src/motor/tablero.js";
import {
  EQUIPOS, nuevaPartida, aplicar, reclutar, recogerLaBandera, renunciarARecoger,
} from "../src/motor/motor.js";
import {
  accionDeBot, puntuarAcciones, decisionDeRecogida, despliegueAleatorio, DISTANCIA,
} from "../src/motor/bot.js";
import { analizarTurno } from "../src/motor/analisis.js";
import { generador, repartoDeTablas } from "./arena.mjs";
import { rasgosDeDespliegue, TAMANO as TAMANO_DESPLIEGUE } from "./rasgos-despliegue.mjs";
import { rasgosDeJugada, contextoDeTurno, TAMANO as TAMANO_JUGADA } from "./rasgos-jugada.mjs";
import { crearRed, entrenarLote, evaluar, aObjeto, desdeObjeto } from "./red.mjs";
import { construirPanel, medirContraPanel, cargarAperturas } from "./panel.mjs";
import { fuenteDeDespliegues } from "./aperturas.mjs";
import { despliegueGuiado } from "./entrenar-despliegue.mjs";
import { accionConRed } from "./entrenar-jugada.mjs";
import { generarInforme } from "./informe-redes.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MODELOS = path.join(AQUI, "modelos");
const [EQUIPO_A, EQUIPO_B] = EQUIPOS;

function opciones(argv) {
  const o = {
    rondas: 6, partidas: 400, epocas: 60, lote: 64, tasa: 0.002, decaimiento: 0.001,
    ocultaDespliegue: 16, ocultaJugada: 28, semilla: 1, limite: 400,
    candidatas: 12, candidatos: 30, escalada: 200, exploracion: 0.22, parejasPanel: 6,
    // Cuántas rondas de ejemplos se conservan. Con una sola, cada ronda ve muy
    // poco y el ajuste va dando bandazos.
    memoria: 3,
    // Fracción de partidas de liga: el otro equipo sale de la mezcla de
    // aperturas y juega con la heurística, para no perder de vista al mundo.
    liga: 0.5,
    // Cuántos errores estándar tiene que sacarle una ronda a la mejor marca
    // para adoptarla. Sin margen se adopta ruido: en una prueba con un solo
    // emparejamiento subió del 53% al 61% con +-6 de error en cada medida, y
    // eso no es una mejora, es la misma red medida dos veces.
    margen: 1,
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

function leer(nombre) {
  const f = path.join(MODELOS, nombre);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

// --- Una tanda de partidas ----------------------------------------------------

function jugarTanda(redD, redJ, o, semillaBase, sacarDespliegue) {
  const deDespliegue = [];
  const deJugada = [];
  let decididas = 0;
  let deLiga = 0;

  for (let i = 0; i < o.partidas; i++) {
    const azar = generador(semillaBase + i * 7919);
    // En las partidas de liga las redes ocupan un equipo y la mezcla el otro. Se
    // alterna el lado, porque el tablero no es simétrico y si las redes jugaran
    // siempre de A la red de despliegue aprendería el sesgo del lado.
    const esLiga = azar() < o.liga;
    const ladoRed = i % 2 === 0 ? EQUIPO_A : EQUIPO_B;
    const conRed = (color) => !esLiga || ladoRed.includes(color);
    if (esLiga) deLiga++;

    const despliegues = {};
    const rasgosPorColor = {};
    for (const color of COLORES) {
      const colocacion = conRed(color)
        ? redD ? despliegueGuiado(color, azar, redD, o.candidatos, o.escalada) : despliegueAleatorio(color, azar)
        : sacarDespliegue(color, azar).colocacion;
      despliegues[color] = colocacion;
      rasgosPorColor[color] = rasgosDeDespliegue(color, colocacion);
    }

    let estado = nuevaPartida(despliegues, { primero: COLORES[Math.floor(azar() * 4)] });
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
      const contexto = contextoDeTurno(estado, color, analizarTurno(estado, color, DISTANCIA));

      let elegida;
      if (!conRed(color)) {
        elegida = finalistas[0].accion; // el rival de liga juega la heurística
      } else if (azar() < o.exploracion) {
        elegida = finalistas[Math.floor(azar() * finalistas.length)].accion;
      } else if (redJ) {
        let mejorValor = -Infinity;
        elegida = finalistas[0].accion;
        for (const { accion } of finalistas) {
          const valor = evaluar(redJ, rasgosDeJugada(estado, color, accion, contexto));
          if (valor > mejorValor) { mejorValor = valor; elegida = accion; }
        }
      } else {
        elegida = finalistas[0].accion;
      }
      // Las jugadas del rival de liga también son ejemplos válidos: el objetivo
      // es el resultado de la partida, y da igual quién eligiera el movimiento.
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
    const suyo = (color) => (EQUIPO_A.includes(color) ? valorA : 1 - valorA);
    for (const color of COLORES) deDespliegue.push({ entrada: rasgosPorColor[color], objetivo: suyo(color) });
    for (const m of muestras) deJugada.push({ entrada: m.entrada, objetivo: suyo(m.color) });
  }
  return { deDespliegue, deJugada, decididas, deLiga };
}

// --- Continuar el entrenamiento de una red ------------------------------------

// `previa` es la red vigente. Se sigue desde sus pesos, no desde cero, y el
// punto de partida entra como candidato en la parada temprana: si ninguna época
// mejora su validación, la ronda devuelve la red tal cual estaba.
function entrenar(ejemplos, tamano, oculta, o, azar, previa) {
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
    return s / (conjunto.length || 1);
  };

  const red = previa ? desdeObjeto(aObjeto(previa)) : crearRed([tamano, oculta, 1], azar);
  let mejor = previa ? perdidaDe(red, validacion) : Infinity;
  let mejorPesos = aObjeto(red);
  const partida = previa ? mejor : null;
  const curva = [];
  let epocasUtiles = 0;
  for (let epoca = 1; epoca <= o.epocas; epoca++) {
    for (let i = 0; i < entrenamiento.length; i += o.lote) {
      entrenarLote(red, entrenamiento.slice(i, i + o.lote), { tasa: o.tasa, decaimiento: o.decaimiento });
    }
    if (epoca % 5 === 0 || epoca === o.epocas) {
      const pEnt = perdidaDe(red, entrenamiento);
      const pVal = perdidaDe(red, validacion);
      curva.push({ epoca, entrenamiento: Number(pEnt.toFixed(5)), validacion: Number(pVal.toFixed(5)) });
      if (pVal < mejor) { mejor = pVal; mejorPesos = aObjeto(red); epocasUtiles = epoca; }
    }
  }
  const buena = desdeObjeto(mejorPesos);
  const cubos = Array.from({ length: 10 }, () => ({ n: 0, suma: 0, real: 0 }));
  let aciertos = 0;
  for (const ej of validacion) {
    const p = evaluar(buena, ej.entrada);
    const c = cubos[Math.min(9, Math.floor(p * 10))];
    c.n++; c.suma += p; c.real += ej.objetivo;
    if ((p > 0.5 ? 1 : 0) === (ej.objetivo > 0.5 ? 1 : 0)) aciertos++;
  }
  return {
    red: buena,
    pesos: mejorPesos,
    perdida: mejor,
    perdidaDePartida: partida,
    epocasUtiles,
    acierto: aciertos / (validacion.length || 1),
    calibracion: cubos.filter((c) => c.n).map((c) => ({ n: c.n, predicho: c.suma / c.n, real: c.real / c.n })),
    curva,
  };
}

// --- Principal ------------------------------------------------------------------

async function main() {
  const o = opciones(process.argv);
  const azar = generador(o.semilla);
  const panel = construirPanel({ azar: generador(2024) }); // panel fijo, no depende de la ronda
  const sacarDespliegue = fuenteDeDespliegues(cargarAperturas(), despliegueAleatorio);

  const guardadoD = leer("red-despliegue.json");
  const guardadoJ = leer("red-jugada.json");
  // Si los rasgos han cambiado de número, el modelo guardado ya no encaja.
  // Cargarlo daría basura sin dar ningún error.
  let redD = guardadoD && guardadoD.red && guardadoD.red.capas[0] === TAMANO_DESPLIEGUE ? desdeObjeto(guardadoD.red) : null;
  let redJ = guardadoJ && guardadoJ.red && guardadoJ.red.capas[0] === TAMANO_JUGADA ? desdeObjeto(guardadoJ.red) : null;

  console.log("Coevolución: las dos redes juegan entre ellas\n");
  console.log(`  ${o.rondas} rondas · ${o.partidas} partidas por ronda · panel de ${panel.length} rivales`);
  console.log(`  arranque: despliegue ${redD ? "modelo guardado" : "desde cero"} · jugada ${redJ ? "modelo guardado" : "desde cero"}`);
  console.log(`  ${Math.round(o.liga * 100)}% de partidas de liga · memoria de ${o.memoria} rondas de ejemplos\n`);

  const historia = [];
  const arranque = Date.now();

  const medir = (rd, rj) => {
    const aspirante = {
      desplegar: (color, az) => (rd ? despliegueGuiado(color, az, rd, o.candidatos, o.escalada) : despliegueAleatorio(color, az)),
      jugar: (estado, color, az) =>
        rj ? accionConRed(estado, color, rj, { candidatas: o.candidatas, azar: az }) : accionDeBot(estado, color, { azar: az }),
    };
    return medirContraPanel(aspirante, panel, { parejas: o.parejasPanel });
  };

  const partida = medir(redD, redJ);
  console.log(`  Punto de partida contra el panel: ${(partida.tasa * 100).toFixed(0)}% ±${Math.round(partida.error * 100)}\n`);
  historia.push({ ronda: 0, panel: partida.tasa, error: partida.error, segundos: Math.round((Date.now() - arranque) / 1000) });
  await publicar(historia, o);

  // Depósito de ejemplos: las últimas `memoria` rondas. Entrenar solo con la
  // ronda recién jugada da muy pocos datos y el ajuste va a bandazos.
  const deposito = [];

  for (let ronda = 1; ronda <= o.rondas; ronda++) {
    const t0 = Date.now();
    const tanda = jugarTanda(redD, redJ, o, o.semilla + ronda * 104729, sacarDespliegue);
    deposito.push(tanda);
    while (deposito.length > o.memoria) deposito.shift();
    const todosD = deposito.flatMap((t) => t.deDespliegue);
    const todosJ = deposito.flatMap((t) => t.deJugada);

    const nuevaD = entrenar(todosD, TAMANO_DESPLIEGUE, o.ocultaDespliegue, o, azar, redD);
    const nuevaJ = entrenar(todosJ, TAMANO_JUGADA, o.ocultaJugada, o, azar, redJ);
    const medida = medir(nuevaD.red, nuevaJ.red);

    // Solo se adoptan si mejoran contra la vara externa, y por encima del
    // ruido. Sin la primera condición la coevolución deriva: las redes se
    // adaptan la una a la otra y se alejan de jugar bien contra cualquier otra
    // cosa. Sin la segunda se adopta ruido, que es igual de malo porque cada
    // adopción mueve el punto de partida de la siguiente ronda.
    const listón = historia[historia.length - 1].panel + o.margen * medida.error;
    const mejora = medida.tasa > listón;
    if (mejora) { redD = nuevaD.red; redJ = nuevaJ.red; }

    console.log(
      `  ronda ${ronda}  ${todosJ.length} jugadas (${tanda.deLiga}/${o.partidas} de liga) · decididas ${tanda.decididas} · ` +
        `panel ${(medida.tasa * 100).toFixed(0)}% ±${Math.round(medida.error * 100)} · ` +
        `peor ${medida.peor.rival} (${(medida.peor.tasa * 100).toFixed(0)}%)` +
        (mejora ? "  <- adoptadas" : `  (descartadas, hacía falta ${(listón * 100).toFixed(0)}%)`) +
        `  ${Math.round((Date.now() - t0) / 1000)}s`
    );

    historia.push({
      ronda, panel: mejora ? medida.tasa : historia[historia.length - 1].panel,
      medida: medida.tasa, error: medida.error, adoptadas: mejora,
      ejemplosDespliegue: todosD.length, ejemplosJugada: todosJ.length,
      decididas: tanda.decididas, deLiga: tanda.deLiga,
      despliegue: { perdida: nuevaD.perdida, perdidaDePartida: nuevaD.perdidaDePartida, epocasUtiles: nuevaD.epocasUtiles, acierto: nuevaD.acierto, calibracion: nuevaD.calibracion, curva: nuevaD.curva },
      jugada: { perdida: nuevaJ.perdida, perdidaDePartida: nuevaJ.perdidaDePartida, epocasUtiles: nuevaJ.epocasUtiles, acierto: nuevaJ.acierto, calibracion: nuevaJ.calibracion, curva: nuevaJ.curva },
      porRival: medida.porRival,
      segundos: Math.round((Date.now() - arranque) / 1000),
    });

    if (mejora) {
      guardar("red-despliegue.json", guardadoD, nuevaD, o, medida);
      guardar("red-jugada.json", guardadoJ, nuevaJ, o, medida);
    }
    await publicar(historia, o);
  }

  const mejorPanel = Math.max(...historia.map((h) => h.panel));
  console.log(`\n  Mejor marca contra el panel: ${(mejorPanel * 100).toFixed(0)}%`);
  console.log(`  Informe: docs/index.html`);
}

function guardar(nombre, previo, entrenada, o, medida) {
  const destino = path.join(MODELOS, nombre);
  fs.writeFileSync(destino, JSON.stringify({
    ...(previo || {}),
    creado: new Date().toISOString(),
    origen: "coevolución",
    opciones: o,
    perdidaValidacion: entrenada.perdida,
    acierto: entrenada.acierto,
    victoriasEnJuego: medida.tasa,
    errorEnJuego: medida.error,
    calibracion: entrenada.calibracion,
    curva: entrenada.curva,
    red: entrenada.pesos,
  }, null, 2));
}

async function publicar(historia, o) {
  fs.writeFileSync(path.join(MODELOS, "coevolucion.json"), JSON.stringify({ creado: new Date().toISOString(), opciones: o, historia }, null, 2));
  // El informe se rehace en cada ronda, para poder mirarlo mientras entrena.
  try {
    await generarInforme();
  } catch (e) {
    console.error("  (el informe falló, el entrenamiento sigue:", e.message + ")");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
