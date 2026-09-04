// Mide los modelos de `entrenamiento/modelos/` contra el panel, con la semilla
// que se le pida. Existe por separado porque medir siempre con las mismas
// semillas convierte cualquier selección en sesgo del máximo, y hace falta poder
// pedir un juego de partidas que no haya visto nadie.
//
//   node herramientas/medir.mjs [semillaBase] [parejas] [carpeta] [camino] [candidatas] [candidatos] [escalada]
//
// `camino` es "solo" (la red puntúa todas las jugadas legales) o "criba" (la
// heurística preselecciona y la red las ordena, que es como juega el servidor).
// NO son comparables entre sí, y confundirlos ya costó anunciar un +3 que no
// existía y, más tarde, leer como regresión lo que era una medida mal alineada.
//
// La criba usa CANDIDATAS_UTILES, el mismo número que el servidor. Antes ponía
// doce a mano mientras el servidor cribaba a cuatro, así que "como juega el
// servidor" no era verdad.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { despliegueAleatorio } from "../src/motor/bot.js";
import { accionConRed, accionConRedProfunda, jugadaSoloRed, despliegueGuiado } from "../src/motor/bot-red.js";
import { desdeObjeto } from "../src/motor/red.js";
import { CANDIDATAS_UTILES } from "../src/motor/dificultad.js";
import { generador } from "../entrenamiento/arena.mjs";
import { construirPanel, medirContraPanel } from "../entrenamiento/panel.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const semillaBase = Number(process.argv[2] ?? 31337);
const parejas = Number(process.argv[3] ?? 8);
const carpeta = process.argv[4] || path.join(AQUI, "..", "entrenamiento", "modelos");
const camino = process.argv[5] || "criba";
// Cuántas candidatas criba la heurística antes de que la red ordene. Por defecto
// las del servidor, pero se puede barrer para ver si ese número sigue siendo el
// bueno: el valor actual se fijó con una red que apenas discriminaba.
const candidatas = Number(process.argv[6] || CANDIDATAS_UTILES);
// Cuántos despliegues se generan y puntúan antes de quedarse con el mejor, y
// cuántos pasos de recocido después. Se pueden barrer: si la red de despliegue
// es lineal, puntuar un candidato es un producto escalar y mirar muchos más sale
// casi gratis.
const candidatos = Number(process.argv[7] || 30);
const escalada = Number(process.argv[8] || 200);

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
    desplegar: (c, az) => (rd ? despliegueGuiado(c, az, rd, candidatos, escalada) : despliegueAleatorio(c, az)),
    jugar: (e, c, az) =>
      !rj ? null
        : camino === "solo" ? jugadaSoloRed(e, c, rj, { azar: az })
        // "profundo" es criba pero mirando la respuesta del siguiente en turno.
        : camino === "profundo" ? accionConRedProfunda(e, c, rj, { candidatas, azar: az })
        : accionConRed(e, c, rj, { candidatas, azar: az }),
  },
  panel,
  { parejas, semillaBase }
);

console.log(JSON.stringify({
  semillaBase, parejas, camino,
  candidatas: camino === "criba" ? candidatas : null,
  candidatos, escalada,
  tasa: r.tasa, error: r.error, gana: r.gana, pierde: r.pierde, tablas: r.tablas,
  peor: { rival: r.peor.rival, tasa: r.peor.tasa },
  porRival: r.porRival.slice().sort((a, b) => a.tasa - b.tasa).slice(0, 8).map((x) => ({ rival: x.rival, clase: x.clase, tasa: x.tasa })),
}));
