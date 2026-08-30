// Mide los modelos contra el panel de rivales, y responde de paso una pregunta
// que quedaba abierta: si las dos redes se suman o se estorban.
//
// Cada aspirante se define por dos cosas independientes, cómo despliega y cómo
// juega, así que se pueden cruzar y ver qué aporta cada mitad.
//
//   node entrenamiento/medir-panel.mjs [parejas]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accionDeBot, despliegueAleatorio } from "../src/motor/bot.js";
import { generador } from "./arena.mjs";
import { construirPanel, medirContraPanel } from "./panel.mjs";
import { desdeObjeto } from "./red.mjs";
import { despliegueGuiado } from "./entrenar-despliegue.mjs";
import { accionConRed } from "./entrenar-jugada.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MODELOS = path.join(AQUI, "modelos");

const leer = (f) => {
  const ruta = path.join(MODELOS, f);
  return fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, "utf8")) : null;
};

const parejas = Number(process.argv[2]) || 12;
const azar = generador(2024);
const panel = construirPanel({ azar });

const redDespliegue = leer("red-despliegue.json");
const redJugada = leer("red-jugada.json");
const rd = redDespliegue ? desdeObjeto(redDespliegue.red) : null;
const rj = redJugada ? desdeObjeto(redJugada.red) : null;

const desplegarAzar = (color, az) => despliegueAleatorio(color, az);
const desplegarConRed = rd ? (color, az) => despliegueGuiado(color, az, rd, 40) : desplegarAzar;
const jugarHeuristica = (estado, color, az) => accionDeBot(estado, color, { azar: az });
const jugarConRed = rj
  ? (estado, color, az) => accionConRed(estado, color, rj, { candidatas: 12, azar: az })
  : jugarHeuristica;

const aspirantes = [
  { nombre: "heurística sola", desplegar: desplegarAzar, jugar: jugarHeuristica },
  { nombre: "red de despliegue", desplegar: desplegarConRed, jugar: jugarHeuristica },
  { nombre: "red de jugada", desplegar: desplegarAzar, jugar: jugarConRed },
  { nombre: "las dos redes", desplegar: desplegarConRed, jugar: jugarConRed },
];

console.log(`Panel de ${panel.length} rivales · ${parejas} emparejamientos contra cada uno\n`);
console.log(`  ${panel.map((r) => r.nombre).join(", ")}\n`);

const resultados = [];
for (const a of aspirantes) {
  const t = Date.now();
  const r = medirContraPanel(a, panel, { parejas });
  resultados.push({ ...a, ...r });
  console.log(
    `  ${a.nombre.padEnd(20)} ${(r.gana + "-" + r.pierde).padStart(9)}  ${(r.tasa * 100).toFixed(0).padStart(3)}% ±${Math.round(r.error * 100)}` +
      `   peor rival: ${r.peor.rival} (${(r.peor.tasa * 100).toFixed(0)}%)   ${Math.round((Date.now() - t) / 1000)}s`
  );
}

// Desglose del mejor, que es donde se ve si gana a todos o solo a los flojos.
const mejor = resultados.reduce((m, r) => (r.tasa > m.tasa ? r : m), resultados[0]);
console.log(`\n  Desglose de "${mejor.nombre}" rival a rival:\n`);
for (const r of mejor.porRival.slice().sort((a, b) => a.tasa - b.tasa)) {
  const barra = "#".repeat(Math.round(r.tasa * 30));
  console.log(`    ${r.rival.padEnd(14)} ${r.clase.padEnd(10)} ${(r.tasa * 100).toFixed(0).padStart(3)}%  ${barra}`);
}

const salida = path.join(MODELOS, "panel.json");
fs.writeFileSync(salida, JSON.stringify({ creado: new Date().toISOString(), parejas, panel: panel.map((r) => ({ nombre: r.nombre, clase: r.clase })), resultados: resultados.map((r) => ({ nombre: r.nombre, tasa: r.tasa, error: r.error, gana: r.gana, pierde: r.pierde, tablas: r.tablas, porRival: r.porRival })) }, null, 2));
console.log(`\n  Guardado en ${path.relative(process.cwd(), salida)}`);
