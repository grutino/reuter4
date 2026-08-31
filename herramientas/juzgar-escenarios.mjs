// Sala de juicios: te enseña escenarios con jugadas candidatas y tú dices si
// cada una es buena, mala o indefinida.
//
//   npm run juzgar          abre en http://localhost:8123
//
// POR QUÉ ESTO Y NO SOLO ROLLOUTS. Etiquetar jugando funciona, pero cuesta
// (candidatas x tiradas partidas por escenario) y solo sabe medir lo que la
// política actual sabe explotar: si las redes no entienden una idea, sus
// rollouts tampoco la valoran. Un juicio humano en una posición concreta corta
// por lo sano y vale para las tácticas raras, que son justo las que no se
// aprenden solas.
//
// Se guarda en `entrenamiento/escenarios/juicios.json` y se mezcla en el
// entrenamiento con más peso que un ejemplo normal, porque hay muchos menos.
//
// Sin dependencias: `node:http` sirve la página y recoge los veredictos. Solo
// escucha en localhost y solo mientras lo tengas abierto.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { puntuarAcciones, DISTANCIA } from "../src/motor/bot.js";
import { generador } from "../entrenamiento/arena.mjs";
import { leerBanco, CARPETA } from "../entrenamiento/escenarios.mjs";
import { NOMBRE_RANGO, ESTILO } from "../src/estilo.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const JUICIOS = path.join(CARPETA, "juicios.json");
const PUERTO = Number(process.env.PORT || 8123);
const CANDIDATAS = Number(process.argv[2] || 5);

const banco = leerBanco();
if (!banco.length) {
  console.error("El banco está vacío. Llénalo antes con:  node entrenamiento/construir-escenarios.mjs");
  process.exit(1);
}

// Cada escenario con sus candidatas ya elegidas, para que el juicio sea siempre
// sobre las mismas jugadas aunque se recargue la página.
const casos = banco.map((esc, i) => {
  const azar = generador(9000 + i);
  const puntuadas = puntuarAcciones(esc.estado, esc.color, { azar });
  const mejores = puntuadas.slice(0, Math.max(0, CANDIDATAS - 1)).map((p) => p.accion);
  // Una del montón: sin alguna mala no hay contraste que juzgar.
  if (puntuadas.length > CANDIDATAS) mejores.push(puntuadas[puntuadas.length - 1].accion);
  return { i, motivo: esc.motivo, color: esc.color, estado: esc.estado, acciones: mejores };
}).filter((c) => c.acciones.length >= 2);

const leerJuicios = () => {
  if (!fs.existsSync(JUICIOS)) return {};
  try { return JSON.parse(fs.readFileSync(JUICIOS, "utf8")).juicios || {}; } catch { return {}; }
};

function guardarJuicio(clave, veredicto) {
  const juicios = leerJuicios();
  juicios[clave] = veredicto;
  fs.mkdirSync(CARPETA, { recursive: true });
  fs.writeFileSync(JUICIOS, JSON.stringify({ creado: new Date().toISOString(), juicios }, null, 1));
  return Object.keys(juicios).length;
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);

  if (url.pathname === "/casos") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ casos, juicios: leerJuicios(), rangos: NOMBRE_RANGO, estilo: ESTILO }));
    return;
  }

  if (url.pathname === "/juicio" && req.method === "POST") {
    let cuerpo = "";
    req.on("data", (t) => { cuerpo += t; if (cuerpo.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try {
        const { clave, veredicto } = JSON.parse(cuerpo);
        const n = guardarJuicio(clave, veredicto);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, total: n }));
      } catch (e) {
        res.writeHead(400); res.end(String(e.message));
      }
    });
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(path.join(AQUI, "juzgar.html"), "utf8"));
    return;
  }

  // Los módulos del cliente, para poder importar la vista tal cual.
  const raiz = path.join(AQUI, "..");
  const destino = path.join(raiz, url.pathname);
  if (destino.startsWith(raiz) && fs.existsSync(destino) && fs.statSync(destino).isFile()) {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    res.end(fs.readFileSync(destino));
    return;
  }
  res.writeHead(404); res.end("no está");
});

servidor.listen(PUERTO, "127.0.0.1", () => {
  const juzgados = Object.keys(leerJuicios()).length;
  console.log(`Sala de juicios en http://localhost:${PUERTO}`);
  console.log(`  ${casos.length} escenarios · ${CANDIDATAS} candidatas cada uno`);
  console.log(`  ${juzgados} juicios ya guardados en ${path.relative(process.cwd(), JUICIOS)}`);
  console.log(`  Ctrl+C para parar.`);
});
