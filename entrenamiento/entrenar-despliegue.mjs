// Entrena una red que juzga posiciones de salida.
//
// El procedimiento es el del manual, sin atajos: se juegan miles de partidas
// con despliegues al azar, se anota el de cada color y si su equipo ganó, y la
// red aprende a predecir esa probabilidad a partir de la geometría del
// despliegue. Después, desplegar es generar candidatos al azar y quedarse con
// el que la red mejor puntúa.
//
// Ninguna recomendación humana entra aquí. Si sale que los cañones quieren ir
// al fondo o que el espía prefiere el borde, habrá salido de los resultados.
//
//   node entrenamiento/entrenar-despliegue.mjs --partidas 1500 --epocas 300

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES } from "../src/motor/tablero.js";
import { EQUIPOS } from "../src/motor/motor.js";
import { despliegueAleatorio, PESOS_BASE } from "../src/motor/bot.js";
import { configuracion, generador, repartoDeTablas } from "./arena.mjs";
import { nuevaPartida, aplicar, reclutar, recogerLaBandera, renunciarARecoger } from "../src/motor/motor.js";
import { accionDeBot, decisionDeRecogida } from "../src/motor/bot.js";
import { rasgosDeDespliegue, TAMANO, nombreDeRasgo } from "./rasgos-despliegue.mjs";
import { crearRed, entrenarLote, evaluar, aObjeto } from "./red.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const [EQUIPO_A] = EQUIPOS;

function opciones(argv) {
  const o = { partidas: 1500, epocas: 300, lote: 64, tasa: 0.01, oculta: 10, decaimiento: 0.0015, semilla: 1, limite: 400, candidatos: 40, medir: 60 };
  for (let i = 2; i < argv.length; i += 2) {
    const clave = argv[i].replace(/^--/, "");
    if (!(clave in o)) throw new Error(`opción desconocida: ${argv[i]}`);
    o[clave] = Number(argv[i + 1]);
  }
  return o;
}

// --- Datos -------------------------------------------------------------------

function generarDatos(partidas, semilla, limite) {
  const ejemplos = [];
  const base = configuracion({ pesos: PESOS_BASE });
  const porColor = Object.fromEntries(COLORES.map((c) => [c, base]));
  let ganadas = 0;
  let tablas = 0;

  for (let i = 0; i < partidas; i++) {
    const semillaPartida = semilla + i * 7919;
    const azar = generador(semillaPartida);
    const despliegues = Object.fromEntries(COLORES.map((c) => [c, despliegueAleatorio(c, azar)]));
    const { estado } = jugarPartidaCon(despliegues, porColor, semillaPartida, limite);

    const fin = estado.fin;
    let valorEquipoA;
    if (fin && fin.ganador) {
      valorEquipoA = EQUIPO_A.includes(fin.ganador) ? 1 : 0;
      ganadas++;
    } else {
      valorEquipoA = repartoDeTablas(estado);
      tablas++;
    }
    for (const color of COLORES) {
      const suyo = EQUIPO_A.includes(color) ? valorEquipoA : 1 - valorEquipoA;
      ejemplos.push({ entrada: rasgosDeDespliegue(color, despliegues[color]), objetivo: suyo });
    }
  }
  return { ejemplos, ganadas, tablas };
}

// --- Despliegue guiado por la red --------------------------------------------

export function despliegueGuiado(color, azar, red, candidatos = 40) {
  let mejor = null;
  let mejorNota = -Infinity;
  for (let i = 0; i < candidatos; i++) {
    const propuesta = despliegueAleatorio(color, azar);
    const nota = evaluar(red, rasgosDeDespliegue(color, propuesta));
    if (nota > mejorNota) {
      mejorNota = nota;
      mejor = propuesta;
    }
  }
  return mejor;
}

// --- Medida: ¿gana un despliegue elegido a uno al azar? ----------------------

function medirEnJuego(red, partidas, candidatos, limite, semillaBase) {
  const base = configuracion({ pesos: PESOS_BASE });
  const porColor = Object.fromEntries(COLORES.map((c) => [c, base]));
  let gana = 0;
  let pierde = 0;
  let empata = 0;

  for (let i = 0; i < partidas; i++) {
    for (const invertido of [false, true]) {
      const semilla = semillaBase + i * 7919;
      const azar = generador(semilla);
      const despliegues = {};
      for (const color of COLORES) {
        const esEquipoA = EQUIPO_A.includes(color);
        // El equipo que "elige" alterna de bando para que el tablero no decida.
        const eligeLaRed = esEquipoA !== invertido;
        despliegues[color] = eligeLaRed
          ? despliegueGuiado(color, azar, red, candidatos)
          : despliegueAleatorio(color, azar);
      }
      const { estado } = jugarPartidaCon(despliegues, porColor, semilla, limite);
      const fin = estado.fin;
      if (!fin || !fin.ganador) {
        empata++;
        continue;
      }
      const ganoEquipoA = EQUIPO_A.includes(fin.ganador);
      if (ganoEquipoA !== invertido) gana++;
      else pierde++;
    }
  }
  return { gana, pierde, empata, tasa: gana + pierde ? gana / (gana + pierde) : 0.5 };
}

// Igual que jugar una partida normal, pero con los despliegues dados desde
// fuera: hacen falta anotados para poder etiquetarlos.
function jugarPartidaCon(despliegues, porColor, semilla, limite) {
  const azar = generador(semilla ^ 0x5f3759df);
  let estado = nuevaPartida(despliegues, { primero: COLORES[Math.floor(azar() * 4)] });
  let turnos = 0;
  while (!estado.fin && turnos < limite) {
    if (estado.pendiente) {
      const p = estado.pendiente;
      estado = p.tipo === "recoger"
        ? (decisionDeRecogida(estado, p.color) ? recogerLaBandera(estado) : renunciarARecoger(estado))
        : reclutar(estado, Math.max(...p.opciones));
      continue;
    }
    const accion = accionDeBot(estado, estado.turno, { pesos: porColor[estado.turno].pesos, azar });
    if (!accion) break;
    estado = aplicar(estado, accion);
    turnos++;
  }
  return { estado, turnos };
}

// --- Principal ---------------------------------------------------------------

async function main() {
  const o = opciones(process.argv);
  const azar = generador(o.semilla);
  console.log("Entrenamiento de la posición de salida\n");

  console.log(`  Jugando ${o.partidas} partidas con despliegues al azar...`);
  const t0 = Date.now();
  const { ejemplos, ganadas, tablas } = generarDatos(o.partidas, o.semilla, o.limite);
  console.log(`  ${ejemplos.length} ejemplos en ${Math.round((Date.now() - t0) / 1000)}s · decididas ${ganadas} · tablas ${tablas}\n`);

  // Un tercio se aparta y no se entrena con él: sin eso, una red con 45
  // entradas memoriza el ruido y la pérdida baja sin que aprenda nada útil.
  const barajado = ejemplos.slice();
  for (let i = barajado.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [barajado[i], barajado[j]] = [barajado[j], barajado[i]];
  }
  const corte = Math.floor(barajado.length * 0.7);
  const entrenamiento = barajado.slice(0, corte);
  const validacion = barajado.slice(corte);

  const perdidaDe = (red, conjunto) => {
    let suma = 0;
    for (const ej of conjunto) {
      const p = evaluar(red, ej.entrada);
      suma += -(ej.objetivo * Math.log(p + 1e-9) + (1 - ej.objetivo) * Math.log(1 - p + 1e-9));
    }
    return suma / conjunto.length;
  };

  const red = crearRed([TAMANO, o.oculta, 1], azar);
  console.log(`  Red ${TAMANO}-${o.oculta}-1 · ${entrenamiento.length} de entrenamiento, ${validacion.length} de validación`);
  console.log(`  pérdida de partida: ${perdidaDe(red, validacion).toFixed(4)}  (adivinar a ciegas ≈ 0.693)\n`);

  let mejorValidacion = Infinity;
  let mejorPesos = null;
  const curva = [];
  for (let epoca = 1; epoca <= o.epocas; epoca++) {
    for (let i = 0; i < entrenamiento.length; i += o.lote) {
      entrenarLote(red, entrenamiento.slice(i, i + o.lote), { tasa: o.tasa, decaimiento: o.decaimiento });
    }
    if (epoca % 10 === 0 || epoca === o.epocas) {
      const pEnt = perdidaDe(red, entrenamiento);
      const pVal = perdidaDe(red, validacion);
      curva.push({ epoca, entrenamiento: Number(pEnt.toFixed(5)), validacion: Number(pVal.toFixed(5)) });
      if (pVal < mejorValidacion) {
        mejorValidacion = pVal;
        mejorPesos = aObjeto(red);
      }
      if (epoca % 50 === 0) {
        console.log(`  época ${String(epoca).padStart(4)}  entrenamiento ${pEnt.toFixed(4)}  validación ${pVal.toFixed(4)}`);
      }
    }
  }
  console.log(`\n  Mejor pérdida de validación: ${mejorValidacion.toFixed(4)}`);

  // La pérdida solo dice que la red predice algo. Lo que importa es si al
  // usarla para elegir despliegue se ganan más partidas.
  const { desdeObjeto } = await import("./red.mjs");
  const mejorRed = desdeObjeto(mejorPesos);
  console.log(`\n  Midiendo en juego: mejor de ${o.candidatos} candidatos contra despliegue al azar...`);
  const t1 = Date.now();
  const medida = medirEnJuego(mejorRed, o.medir, o.candidatos, o.limite, 424242);
  console.log(`  ${medida.gana}-${medida.pierde} (tablas ${medida.empata}) = ${(medida.tasa * 100).toFixed(0)}% de victorias en ${Math.round((Date.now() - t1) / 1000)}s`);

  const salida = path.join(AQUI, "modelos", "red-despliegue.json");
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(
    salida,
    JSON.stringify(
      { creado: new Date().toISOString(), opciones: o, perdidaValidacion: mejorValidacion, victoriasEnJuego: medida.tasa, curva, red: mejorPesos },
      null,
      2
    )
  );
  console.log(`\n  Guardado en ${path.relative(process.cwd(), salida)}`);
}

if (process.argv[1] && process.argv[1].endsWith("entrenar-despliegue.mjs")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
