// Mide los modelos de `entrenamiento/modelos/` contra el panel, con la semilla
// que se le pida. Existe por separado porque medir siempre con las mismas
// semillas convierte cualquier selección en sesgo del máximo, y hace falta poder
// pedir un juego de partidas que no haya visto nadie.
//
//   node herramientas/medir.mjs [semillaBase] [parejas] [carpeta]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { despliegueAleatorio } from "../src/motor/bot.js";
import { accionConRed, despliegueGuiado } from "../src/motor/bot-red.js";
import { desdeObjeto } from "../src/motor/red.js";
import { generador } from "../entrenamiento/arena.mjs";
import { construirPanel, medirContraPanel } from "../entrenamiento/panel.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const semillaBase = Number(process.argv[2] ?? 31337);
const parejas = Number(process.argv[3] ?? 8);
const carpeta = process.argv[4] || path.join(AQUI, "..", "entrenamiento", "modelos");

const leer = (f) => {
  const r = path.join(carpeta, f);
  return fs.existsSync(r) ? JSON.parse(fs.readFileSync(r, "utf8")) : null;
};
const gd = leer("red-despliegue.json");
const gj = leer("red-jugada.json");
const rd = gd && gd.red ? desdeObjeto(gd.red) : null;
const rj = gj && gj.red ? desdeObjeto(gj.red) : null;

const panel = construirPanel({ azar: generador(2024) });
const r = medirContraPanel(
  {
    desplegar: (c, az) => (rd ? despliegueGuiado(c, az, rd, 30, 200) : despliegueAleatorio(c, az)),
    jugar: (e, c, az) => (rj ? accionConRed(e, c, rj, { candidatas: 12, azar: az }) : null),
  },
  panel,
  { parejas, semillaBase }
);

console.log(JSON.stringify({
  semillaBase, parejas,
  tasa: r.tasa, error: r.error, gana: r.gana, pierde: r.pierde, tablas: r.tablas,
  peor: { rival: r.peor.rival, tasa: r.peor.tasa },
  porRival: r.porRival.slice().sort((a, b) => a.tasa - b.tasa).slice(0, 8).map((x) => ({ rival: x.rival, clase: x.clase, tasa: x.tasa })),
}));
