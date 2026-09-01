// Llena el banco de escenarios y lo etiqueta jugando.
//
//   node entrenamiento/construir-escenarios.mjs --partidas 300 --tiradas 3
//
// Es un paso aparte y no parte de la coevolución porque cuesta: cada escenario
// son (candidatas x tiradas) partidas jugadas hasta el final. A cambio, el banco
// se reutiliza entre entrenamientos.

import fs from "node:fs";
import path from "node:path";
import { desdeObjeto } from "../src/motor/red.js";
import { accionConRed } from "../src/motor/bot-red.js";
import { cargarModelos } from "../src/motor/modelos.js";
import { accionDeBot } from "../src/motor/bot.js";
import { FIRMA as FIRMA_JUGADA, TAMANO as TAMANO_JUGADA } from "../src/motor/rasgos-jugada.js";
import {
  recolectar, etiquetar, ejemplosDeEscenario, guardarBanco, leerBanco,
  resumenDelBanco, firmaDePosicion, CARPETA,
} from "./escenarios.mjs";

function opciones(argv) {
  const o = { partidas: 300, semilla: 1, candidatas: 6, tiradas: 3, limite: 200, tope: 600, porPartida: 3, acumular: 1 };
  for (let i = 2; i < argv.length; i += 2) {
    const clave = argv[i].replace(/^--/, "");
    if (!(clave in o)) throw new Error(`opción desconocida: ${argv[i]}`);
    o[clave] = Number(argv[i + 1]);
  }
  return o;
}

const o = opciones(process.argv);
const modelos = cargarModelos();
// Los rollouts se juegan con lo mejor que haya: si hay red publicada, con ella.
const jugar = modelos.jugada
  ? (e, c, az) => accionConRed(e, c, modelos.jugada, { candidatas: 12, azar: az })
  : (e, c, az) => accionDeBot(e, c, { azar: az });

console.log("Banco de escenarios\n");
console.log(`  ${o.partidas} partidas para buscar · ${o.candidatas} candidatas x ${o.tiradas} tiradas por escenario`);
console.log(`  rollouts con ${modelos.jugada ? "la red publicada" : "la heurística"}\n`);

const previos = o.acumular ? leerBanco() : [];
const t0 = Date.now();
const nuevos = recolectar({ partidas: o.partidas, semilla: o.semilla, porPartida: o.porPartida, jugar });
console.log(`  encontrados ${nuevos.length} escenarios en ${Math.round((Date.now() - t0) / 1000)}s`);

const vistas = new Set(previos.map((e) => firmaDePosicion(e.estado) + "#" + e.color));
const juntos = [...previos];
for (const e of nuevos) {
  const f = firmaDePosicion(e.estado) + "#" + e.color;
  if (vistas.has(f)) continue;
  vistas.add(f);
  juntos.push(e);
}
const banco = guardarBanco(juntos, o.tope);
console.log(`  banco: ${banco.length} escenarios · ${JSON.stringify(resumenDelBanco(banco))}\n`);

// --- Etiquetar ---------------------------------------------------------------
const t1 = Date.now();
const ejemplos = [];
let separan = 0;
let planos = 0;
banco.forEach((esc, i) => {
  const evaluadas = etiquetar(esc, { candidatas: o.candidatas, tiradas: o.tiradas, limite: o.limite, jugar, semilla: 11 + i });
  if (!evaluadas) return;
  const valores = evaluadas.map((x) => x.valor);
  // Un escenario donde todas las jugadas valen lo mismo no enseña nada: es una
  // posición donde da igual lo que hagas, y ocupa sitio.
  const rango = Math.max(...valores) - Math.min(...valores);
  if (rango >= 0.15) separan++; else planos++;
  ejemplos.push(...ejemplosDeEscenario(esc, evaluadas));
  if ((i + 1) % 25 === 0) console.log(`  ...${i + 1}/${banco.length} escenarios etiquetados`);
});

const salida = path.join(CARPETA, "ejemplos.json");
fs.writeFileSync(salida, JSON.stringify({
  // La firma va con los ejemplos por la misma razón que va con los modelos: si
  // los rasgos cambian, estos vectores dejan de significar lo que decían y se
  // cargarían como basura sin dar ningún error.
  firmaRasgos: FIRMA_JUGADA, entradas: TAMANO_JUGADA,
  creado: new Date().toISOString(), opciones: o,
  ejemplos: ejemplos.map((e) => ({ entrada: Array.from(e.entrada), objetivo: e.objetivo, motivo: e.motivo })),
}, null, 1));

console.log(`\n  ${ejemplos.length} ejemplos etiquetados en ${Math.round((Date.now() - t1) / 60000)} min`);
console.log(`  escenarios que separan jugadas (rango >= 0,15): ${separan} · planos: ${planos}`);
console.log(`  Guardado en ${path.relative(process.cwd(), salida)}`);
