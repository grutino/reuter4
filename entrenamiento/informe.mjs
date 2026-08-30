// Página de seguimiento del entrenamiento.
//
// Se reescribe entera en cada generación, así que se puede tener abierta
// mientras entrena y ver la curva crecer: la página se recarga sola mientras el
// entrenamiento sigue vivo y deja de hacerlo cuando termina.
//
// Sin dependencias y sin JavaScript en la página: todo son SVG generados aquí.
// Así el fichero se puede versionar, abrir con un doble clic y mirar desde el
// móvil sin levantar ningún servidor.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PESOS_BASE } from "../src/motor/bot.js";
import { ESCALAS, GENES } from "./genoma.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

const COLOR = {
  fondo: "#241a12",
  panel: "#2f2318",
  tinta: "#E8DCC2",
  suave: "#C9BC9C",
  laton: "#E2BB6B",
  linea: "#7a6647",
  bien: "#7FB069",
  mal: "#C97A6A",
  acento: "#6FA8C7",
};

const escapar = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// --- Gráficos ----------------------------------------------------------------

function grafico({ series, titulo, ancho = 720, alto = 240, min, max, formatoY = (v) => v.toFixed(2) }) {
  const M = { arriba: 16, derecha: 14, abajo: 28, izquierda: 46 };
  const w = ancho - M.izquierda - M.derecha;
  const h = alto - M.arriba - M.abajo;
  const puntos = series.flatMap((s) => s.datos);
  if (!puntos.length) return "";
  const xs = puntos.map((p) => p.x);
  const ys = puntos.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 1);
  const y0 = min !== undefined ? min : Math.min(...ys);
  const y1 = max !== undefined ? max : Math.max(...ys);
  const rango = y1 - y0 || 1;
  const px = (x) => M.izquierda + ((x - x0) / (x1 - x0)) * w;
  const py = (y) => M.arriba + h - ((y - y0) / rango) * h;

  const rejilla = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const v = y0 + f * rango;
      const y = py(v);
      return `<line x1="${M.izquierda}" y1="${y}" x2="${M.izquierda + w}" y2="${y}" stroke="${COLOR.linea}" stroke-width="1" opacity="0.35"/>
      <text x="${M.izquierda - 8}" y="${y + 4}" fill="${COLOR.suave}" font-size="11" text-anchor="end">${formatoY(v)}</text>`;
    })
    .join("");

  const trazos = series
    .map((s) => {
      if (s.datos.length < 2) return "";
      const d = s.datos.map((p, i) => `${i ? "L" : "M"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    })
    .join("");

  const leyenda = series
    .map((s, i) => {
      const x = M.izquierda + 6 + i * 150;
      return `<rect x="${x}" y="${M.arriba + 2}" width="10" height="10" fill="${s.color}"/>
        <text x="${x + 15}" y="${M.arriba + 11}" fill="${COLOR.suave}" font-size="11">${escapar(s.nombre)}</text>`;
    })
    .join("");

  return `<figure>
    <figcaption>${escapar(titulo)}</figcaption>
    <svg viewBox="0 0 ${ancho} ${alto}" width="100%" role="img">
      ${rejilla}
      <line x1="${M.izquierda}" y1="${M.arriba + h}" x2="${M.izquierda + w}" y2="${M.arriba + h}" stroke="${COLOR.linea}"/>
      ${trazos}${leyenda}
      <text x="${M.izquierda + w}" y="${alto - 8}" fill="${COLOR.suave}" font-size="11" text-anchor="end">generación ${x1}</text>
    </svg>
  </figure>`;
}

// Barras divergentes: cada peso entrenado frente al escrito a mano. Se comparan
// en unidades de su escala, que es lo único que los hace comparables entre sí.
function graficoPesos(pesos) {
  const filas = GENES.map((k) => ({
    nombre: k,
    entrenado: (pesos[k] || 0) / ESCALAS[k],
    aMano: (PESOS_BASE[k] || 0) / ESCALAS[k],
  }));
  const tope = Math.max(1.5, ...filas.flatMap((f) => [Math.abs(f.entrenado), Math.abs(f.aMano)]));
  const altoFila = 20;
  const ancho = 720;
  // Las etiquetas van en columna propia a la izquierda: si se ponen pegadas al
  // eje, las barras negativas les pasan por encima y no se lee nada.
  const columnaEtiquetas = 160;
  const centro = 450;
  const escalaPx = Math.min(ancho - 30 - centro, centro - columnaEtiquetas - 12) / tope;

  const barras = filas
    .map((f, i) => {
      const y = i * altoFila + 14;
      const barra = (v, color, grosor, desplaz) => {
        const largo = Math.abs(v) * escalaPx;
        const x = v >= 0 ? centro : centro - largo;
        return `<rect x="${x.toFixed(1)}" y="${y - grosor + desplaz}" width="${largo.toFixed(1)}" height="${grosor}" fill="${color}" opacity="0.95"/>`;
      };
      return `<text x="${columnaEtiquetas}" y="${y + 2}" fill="${COLOR.suave}" font-size="11" text-anchor="end">${escapar(f.nombre)}</text>
        ${barra(f.aMano, COLOR.linea, 5, -1)}
        ${barra(f.entrenado, f.entrenado >= 0 ? COLOR.bien : COLOR.mal, 7, 7)}`;
    })
    .join("");

  return `<figure>
    <figcaption>Pesos del modelo frente a la heurística escrita a mano (en unidades de su escala)</figcaption>
    <svg viewBox="0 0 ${ancho} ${filas.length * altoFila + 30}" width="100%" role="img">
      <line x1="${centro}" y1="6" x2="${centro}" y2="${filas.length * altoFila + 10}" stroke="${COLOR.linea}"/>
      ${barras}
      <rect x="${centro + 10}" y="${filas.length * altoFila + 16}" width="10" height="5" fill="${COLOR.linea}"/>
      <text x="${centro + 26}" y="${filas.length * altoFila + 22}" fill="${COLOR.suave}" font-size="11">a mano</text>
      <rect x="${centro + 90}" y="${filas.length * altoFila + 16}" width="10" height="7" fill="${COLOR.bien}"/>
      <text x="${centro + 106}" y="${filas.length * altoFila + 22}" fill="${COLOR.suave}" font-size="11">entrenado</text>
    </svg>
  </figure>`;
}

// --- Página ------------------------------------------------------------------

export function construirInforme(modelos, { enMarcha = false } = {}) {
  const bloques = modelos
    .map((m) => {
      const h = m.historia || [];
      const ultima = h[h.length - 1] || {};
      const pct = (v) => (v === undefined ? "—" : `${(v * 100).toFixed(0)}%`);

      const datos = (campo) => h.map((f) => ({ x: f.generacion, y: f[campo] }));

      const fichas = [
        ["mejor puntuación", pct(m.mejorPuntuacion)],
        ["victorias, última medida", pct(ultima.contraBase)],
        ["generaciones", h.length],
        ["arranque", m.opciones ? m.opciones.inicio : "—"],
        ["población", m.opciones ? m.opciones.poblacion : "—"],
        ["tope de turnos", m.opciones ? m.opciones.limite : "—"],
        ["tiempo", ultima.segundos !== undefined ? `${Math.round(ultima.segundos / 60)} min` : "—"],
      ]
        .map(([k, v]) => `<div class="ficha"><span>${escapar(k)}</span><strong>${escapar(v)}</strong></div>`)
        .join("");

      return `<section>
        <h2>${escapar(m.titulo || "entrenamiento")}</h2>
        <div class="fichas">${fichas}</div>
        ${grafico({
          titulo: "Curva de mejora: el modelo contra la heurística escrita a mano",
          min: 0,
          max: 1,
          formatoY: (v) => `${Math.round(v * 100)}%`,
          series: [
            { nombre: "puntuación (tablas incluidas)", color: COLOR.laton, datos: datos("puntuacionContraBase") },
            { nombre: "victorias", color: COLOR.bien, datos: datos("contraBase") },
          ],
        })}
        ${grafico({
          titulo: "Aptitud dentro de la población, contra el panel de rivales",
          min: 0,
          max: 1,
          formatoY: (v) => `${Math.round(v * 100)}%`,
          series: [
            { nombre: "mejor de la generación", color: COLOR.acento, datos: datos("aptitudMejor") },
            { nombre: "media", color: COLOR.suave, datos: datos("aptitudMedia") },
          ],
        })}
        ${grafico({
          titulo: "Exploración: cuánto se mueve la búsqueda",
          min: 0,
          series: [
            { nombre: "sigma", color: COLOR.laton, datos: datos("sigma") },
            { nombre: "paso de la media", color: COLOR.acento, datos: datos("paso") },
          ],
        })}
        ${grafico({
          titulo: "Partidas sin decidir y duración media",
          min: 0,
          formatoY: (v) => Math.round(v),
          series: [
            { nombre: "tablas por medición", color: COLOR.mal, datos: datos("tablasContraBase") },
            { nombre: "turnos de media", color: COLOR.suave, datos: datos("turnosMedia") },
          ],
        })}
        ${graficoPesos(m.pesos || {})}
      </section>`;
    })
    .join("");

  return `<title>Reuter4 · entrenamiento de los bots</title>
${enMarcha ? '<meta http-equiv="refresh" content="15">' : ""}
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 28px 22px 60px; background: ${COLOR.fondo}; color: ${COLOR.tinta};
         font: 15px/1.6 Georgia, "Times New Roman", serif; }
  .envoltorio { max-width: 780px; margin: 0 auto; }
  h1 { font-size: 24px; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 4px; }
  h1 span { color: ${COLOR.laton}; }
  .estado { font-size: 13px; color: ${COLOR.suave}; margin-bottom: 26px; }
  .estado b { color: ${COLOR.bien}; font-weight: normal; }
  section { background: ${COLOR.panel}; border: 1px solid ${COLOR.linea}; border-radius: 6px;
            padding: 16px 18px 6px; margin-bottom: 22px; }
  h2 { font-size: 15px; font-weight: normal; letter-spacing: .08em; text-transform: uppercase;
       color: ${COLOR.laton}; margin: 0 0 12px; }
  .fichas { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .ficha { background: rgba(0,0,0,.22); border-radius: 4px; padding: 6px 10px; min-width: 96px; }
  .ficha span { display: block; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: ${COLOR.suave}; }
  .ficha strong { font-size: 17px; font-weight: normal; }
  figure { margin: 0 0 18px; }
  figcaption { font-size: 12.5px; color: ${COLOR.suave}; margin-bottom: 4px; }
  footer { font-size: 12px; color: ${COLOR.suave}; text-align: center; margin-top: 24px; }
</style>
<div class="envoltorio">
  <h1>Reuter<span>4</span> · entrenamiento</h1>
  <p class="estado">${
    enMarcha
      ? '<b>Entrenando ahora.</b> Esta página se recarga sola cada 15 segundos.'
      : "Entrenamiento terminado."
  } Generado el ${escapar(new Date().toLocaleString("es-ES"))}.</p>
  ${bloques}
  <footer>Los bots aprenden jugando contra versiones anteriores de sí mismos.<br>
  La heurística escrita a mano no se entrena: está solo como vara de medir.</footer>
</div>`;
}

export function escribirInforme(modelos, destino, opciones) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, construirInforme(modelos, opciones));
}

// Uso directo: node entrenamiento/informe.mjs [fichero.json ...]
if (process.argv[1] && process.argv[1].endsWith("informe.mjs")) {
  const rutas = process.argv.slice(2);
  const carpeta = path.join(AQUI, "modelos");
  const ficheros = rutas.length
    ? rutas
    : fs.existsSync(carpeta)
    ? fs.readdirSync(carpeta).filter((f) => f.endsWith(".json")).map((f) => path.join(carpeta, f))
    : [];
  if (!ficheros.length) {
    console.error("No hay modelos que informar. Entrena primero con: npm run entrenar");
    process.exit(1);
  }
  const modelos = ficheros.map((f) => ({ ...JSON.parse(fs.readFileSync(f, "utf8")), titulo: path.basename(f, ".json") }));
  const destino = path.join(AQUI, "informe", "index.html");
  escribirInforme(modelos, destino, { enMarcha: false });
  console.log("Informe escrito en", path.relative(process.cwd(), destino));
}
