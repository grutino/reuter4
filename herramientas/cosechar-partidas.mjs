// Convierte las partidas terminadas en material para juzgar.
//
// Una partida jugada de verdad es lo más caro que produce el proyecto: cuatro
// despliegues completos y un hilo de decisiones con su resultado. Hasta ahora
// se moría en la pestaña del navegador. Aquí se cosecha en dos productos:
//
//   1. Los CUATRO DESPLIEGUES van a un pozo del que la herramienta de juicios
//      saca parejas. Un despliegue de partida real vale más que uno generado:
//      lo eligió alguien —persona o red— para jugar, no el azar.
//
//   2. Las POSICIONES DUDOSAS van al banco de escenarios. No cualquier posición:
//      solo aquellas donde la red y lo que se jugó discrepan mucho. Ahí es donde
//      un juicio humano aporta lo que ni la red ni los rollouts pueden dar.
//
// Por qué NO se aprende de la partida directamente, sin pasar por el juicio: en
// una partida el resultado está confundido con todo lo demás. Un despliegue que
// ganó pudo ganar a pesar de sí mismo, y una jugada que precedió a la derrota
// pudo ser la única buena de la posición. El resultado por sí solo etiquetaría
// mal, y con cuatro partidas al día no hay volumen que compense el ruido. El
// juicio corta ese nudo: no pregunta qué pasó, pregunta qué era mejor.
//
//   node herramientas/cosechar-partidas.mjs            cosecha lo nuevo
//   node herramientas/cosechar-partidas.mjs --todas    vuelve a cosechar todo

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES } from "../src/motor/tablero.js";
import { EQUIPOS } from "../src/motor/motor.js";
import { reproducirPartida, ReplayImposible } from "../src/motor/replay.js";
import { sospechosos } from "../src/motor/analisis-partida.js";
import { cargarModelos } from "../src/motor/modelos.js";
import { firmaDePosicion, leerBanco, guardarBanco, motivoDeInteres } from "../entrenamiento/escenarios.mjs";
import { analizarTurno } from "../src/motor/analisis.js";
import { DISTANCIA } from "../src/motor/bot.js";
import { CARPETA } from "../entrenamiento/escenarios.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVO = path.join(AQUI, "..", "partidas");
const POZO = path.join(CARPETA, "despliegues-jugados.json");
const MARCA = path.join(ARCHIVO, "cosechadas.json");
const todas = process.argv.includes("--todas");

const leerJson = (ruta, siFalta) => {
  if (!fs.existsSync(ruta)) return siFalta;
  try { return JSON.parse(fs.readFileSync(ruta, "utf8")); } catch { return siFalta; }
};

const partidas = fs.existsSync(ARCHIVO)
  ? fs.readdirSync(ARCHIVO).filter((f) => f.endsWith(".json") && f !== "cosechadas.json").sort()
  : [];

if (!partidas.length) {
  console.log(`No hay partidas archivadas en ${path.relative(process.cwd(), ARCHIVO)}.`);
  console.log("Se archivan solas al terminar una partida con ganador.");
  process.exit(0);
}

const yaHechas = new Set(todas ? [] : leerJson(MARCA, { hechas: [] }).hechas);
const pendientes = partidas.filter((f) => !yaHechas.has(f));

console.log(`Cosecha de partidas terminadas\n`);
console.log(`  ${partidas.length} archivadas · ${pendientes.length} por cosechar\n`);
if (!pendientes.length) {
  console.log("  Nada nuevo. Con --todas se vuelve a cosechar lo ya hecho.");
  process.exit(0);
}

const modelos = cargarModelos();
if (!modelos.jugada) {
  console.log("  Sin red de jugada publicada: se cosechan los despliegues, pero no");
  console.log("  las posiciones dudosas (hace falta la red para saber cuáles lo son).\n");
}

const pozo = leerJson(POZO, { creado: new Date().toISOString(), despliegues: [] });
const yaEnPozo = new Set(pozo.despliegues.map((d) => d.clave));
const banco = leerBanco();
const yaEnBanco = new Set(banco.map((e) => e.firma));

const claveDe = (color, colocacion) =>
  color + ":" + colocacion.slice().sort((x, y) => (x.casilla < y.casilla ? -1 : 1)).map((p) => `${p.casilla}-${p.rango}`).join(",");

let despliegues = 0;
let posiciones = 0;
let rotas = 0;
const hechas = new Set(yaHechas);

for (const fichero of pendientes) {
  const partida = leerJson(path.join(ARCHIVO, fichero), null);
  if (!partida || !partida.despliegues || !partida.historia) {
    rotas++;
    continue;
  }

  // 1. Los cuatro despliegues.
  const ganador = partida.fin && partida.fin.ganador;
  for (const color of COLORES) {
    const colocacion = partida.despliegues[color];
    if (!colocacion || !colocacion.length) continue;
    const clave = claveDe(color, colocacion);
    if (yaEnPozo.has(clave)) continue;
    yaEnPozo.add(clave);
    pozo.despliegues.push({
      clave,
      color,
      colocacion,
      // El resultado se guarda pero NO se enseña al que juzga: sabiendo quién
      // ganó, el juicio deja de ser una opinión sobre el despliegue y pasa a
      // ser una racionalización del resultado.
      gano: ganador ? EQUIPOS.some((e) => e.includes(color) && e.includes(ganador)) : null,
      partida: fichero,
    });
    despliegues++;
  }

  // 2. Las posiciones dudosas.
  if (modelos.jugada) {
    try {
      const { pasos } = reproducirPartida(partida.despliegues, partida.historia);
      for (const m of sospechosos(pasos, modelos.jugada, { cuantos: 4 })) {
        const firma = firmaDePosicion(m.estado);
        if (yaEnBanco.has(firma)) continue;
        yaEnBanco.add(firma);
        banco.push({
          firma,
          estado: m.estado,
          color: m.color,
          motivo: motivoDeInteres(m.estado, m.color, analizarTurno(m.estado, m.color, DISTANCIA)) || "discrepa con la red",
          origen: fichero,
        });
        posiciones++;
      }
    } catch (e) {
      if (!(e instanceof ReplayImposible)) throw e;
      // Un hilo que no se puede reproducir no se cosecha a medias.
      rotas++;
    }
  }
  hechas.add(fichero);
}

fs.mkdirSync(CARPETA, { recursive: true });
fs.writeFileSync(POZO, JSON.stringify({ ...pozo, actualizado: new Date().toISOString() }, null, 1));
if (posiciones) guardarBanco(banco);
fs.writeFileSync(MARCA, JSON.stringify({ hechas: [...hechas].sort() }, null, 1));

console.log(`  ${despliegues} despliegues nuevos al pozo (${pozo.despliegues.length} en total)`);
console.log(`  ${posiciones} posiciones dudosas al banco (${banco.length} en total)`);
if (rotas) console.log(`  ${rotas} partidas sin cosechar: el hilo no se puede reproducir`);
console.log(`\n  Ya se pueden juzgar:  npm run juzgar-despliegues   ·   npm run juzgar`);
