// El informe de fin de partida: un documento imprimible con lo que pasó.
//
// Se abre en una pestaña nueva y se guarda en PDF con el propio diálogo de
// imprimir del navegador. Sin biblioteca de PDF: el proyecto no arrastra
// dependencias, y el "Guardar como PDF" del sistema hace exactamente lo que
// hace falta.
//
// Lo que lleva:
//   · los cuatro despliegues iniciales, ya destapados
//   · un diagrama de flechas por bando, que es donde se lee la estrategia
//   · el hilo completo de jugadas con sus combates
//
// Nada de esto sale del cliente por su cuenta: el servidor solo manda los rangos
// ajenos y los despliegues iniciales cuando `estado.fin` está puesto.

import { CASILLAS, LAGOS, CASTILLO_HUELLA, ANILLO, TORRE, ZONAS, coord, casillasDeZona } from "./motor/tablero.js";
import { ESTILO, NOMBRE_RANGO } from "./estilo.js";

const LADO = 15;
const CELDA = 26;
const MARGEN = 14;
const TABLERO = LADO * CELDA + MARGEN * 2;

const esc = (t) =>
  String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// El centro del castillo en píxeles, para las pseudocasillas.
const CENTRO_CASTILLO = (() => {
  const cs = [...CASTILLO_HUELLA].map(coord);
  const x = (Math.min(...cs.map((p) => p[0])) + Math.max(...cs.map((p) => p[0]))) / 2;
  const y = (Math.min(...cs.map((p) => p[1])) + Math.max(...cs.map((p) => p[1]))) / 2;
  return { x, y };
})();

// ANILLO y TORRE no tienen coordenadas: son pseudocasillas. Se pintan sobre el
// castillo, la torre en el centro y el anillo un poco desplazado para que dos
// flechas al castillo no se superpongan del todo.
function centro(casilla) {
  if (casilla === TORRE) return px(CENTRO_CASTILLO.x, CENTRO_CASTILLO.y);
  if (casilla === ANILLO) return px(CENTRO_CASTILLO.x, CENTRO_CASTILLO.y - 1);
  const c = coord(casilla);
  return c ? px(c[0], c[1]) : null;
}
const px = (columna, fila) => ({
  x: MARGEN + (columna - 1) * CELDA + CELDA / 2,
  y: MARGEN + (fila - 1) * CELDA + CELDA / 2,
});

// --- El tablero de fondo, común a todos los diagramas -------------------------
//
// Se define UNA vez como <symbol> y los ocho diagramas lo referencian con <use>.
// Dibujarlo entero en cada uno son 225 rectángulos por ocho: el documento pasaba
// de 258 KB, casi todo fondo repetido.

function fondoDelTablero() {
  const partes = [];
  const jugables = new Set(CASILLAS);
  for (let f = 1; f <= LADO; f++) {
    for (let c = 1; c <= LADO; c++) {
      const x = MARGEN + (c - 1) * CELDA;
      const y = MARGEN + (f - 1) * CELDA;
      const nombre = `${String.fromCharCode(64 + c)}${f}`;
      let relleno = "#efeae0"; // bosque o fuera de juego
      if (LAGOS.has(nombre)) relleno = "#bcd4e6";
      else if (CASTILLO_HUELLA.has(nombre)) relleno = "#d8cbb0";
      else if (jugables.has(nombre)) relleno = "#fbf8f2";
      partes.push(`<rect x="${x}" y="${y}" width="${CELDA}" height="${CELDA}" fill="${relleno}" stroke="#e0d8c8" stroke-width="0.5"/>`);
    }
  }
  // Las zonas de cada ejército, con un tinte suave para orientarse.
  for (const [color, estilo] of Object.entries(ESTILO)) {
    for (const casilla of casillasDeZona(color)) {
      const c = coord(casilla);
      if (!c) continue;
      partes.push(
        `<rect x="${MARGEN + (c[0] - 1) * CELDA}" y="${MARGEN + (c[1] - 1) * CELDA}" width="${CELDA}" height="${CELDA}" fill="${estilo.css}" opacity="0.10"/>`
      );
    }
  }
  const t = px(CENTRO_CASTILLO.x, CENTRO_CASTILLO.y);
  partes.push(`<circle cx="${t.x}" cy="${t.y}" r="${CELDA * 0.55}" fill="none" stroke="#8a7a5a" stroke-width="1.5"/>`);
  return partes.join("");
}

// El símbolo va una sola vez en el documento, en un svg de tamaño cero.
function definicionDelTablero() {
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <symbol id="tablero" viewBox="0 0 ${TABLERO} ${TABLERO}">${fondoDelTablero()}</symbol>
  </defs></svg>`;
}

const FONDO = `<use href="#tablero" x="0" y="0" width="${TABLERO}" height="${TABLERO}"/>`;

// --- Despliegue inicial de un ejército ---------------------------------------

function diagramaDeDespliegue(color, colocacion) {
  const fichas = (colocacion || []).map((p) => {
    const c = centro(p.casilla);
    if (!c) return "";
    return (
      `<circle cx="${c.x}" cy="${c.y}" r="${CELDA * 0.40}" fill="${ESTILO[color].css}" stroke="#fff" stroke-width="1"/>` +
      `<text x="${c.x}" y="${c.y + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${p.rango}</text>` +
      (p.bandera ? `<circle cx="${c.x}" cy="${c.y}" r="${CELDA * 0.48}" fill="none" stroke="#C9A227" stroke-width="2"/>` : "")
    );
  });
  return `<svg viewBox="0 0 ${TABLERO} ${TABLERO}" width="100%" role="img" aria-label="Despliegue inicial de ${color}">
    ${FONDO}${fichas.join("")}
  </svg>`;
}

// --- Diagrama de flechas: por dónde se movió cada bando -----------------------

function diagramaDeMovimientos(color, historia) {
  const jugadas = (historia || []).filter((h) => h.color === color && h.desde && h.hasta);
  const total = Math.max(1, jugadas.length);
  const flechas = jugadas.map((h, i) => {
    const a = centro(h.desde);
    const b = centro(h.hasta);
    if (!a || !b) return "";
    // El avance del tiempo se lee en la opacidad: las primeras jugadas casi no
    // se ven y las últimas van sólidas, así que el dibujo se lee como una
    // secuencia y no como una maraña.
    const t = 0.18 + 0.72 * (i / total);
    const combate = (h.eventos || []).some((e) => e.tipo === "duelo" || e.tipo === "cañonazo");
    return (
      `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${ESTILO[color].css}" stroke-width="${combate ? 2.4 : 1.3}" opacity="${t.toFixed(2)}" marker-end="url(#punta-${color})"/>` +
      (combate ? `<circle cx="${b.x}" cy="${b.y}" r="3.4" fill="#8B1A1A" opacity="${Math.min(1, t + 0.25).toFixed(2)}"/>` : "")
    );
  });
  const disparos = (historia || []).filter((h) => h.color === color && h.tipo === "disparar").length;
  return `<svg viewBox="0 0 ${TABLERO} ${TABLERO}" width="100%" role="img" aria-label="Movimientos de ${color}">
    <defs><marker id="punta-${color}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,0 L8,4 L0,8 z" fill="${ESTILO[color].css}"/></marker></defs>
    ${FONDO}${flechas.join("")}
  </svg>
  <p class="pie">${jugadas.length} jugadas · ${disparos} cañonazos · los puntos rojos son combates · las flechas se oscurecen con el paso de los turnos</p>`;
}

// --- El hilo, en texto --------------------------------------------------------

const CASILLA = (c) => (c === ANILLO ? "anillo" : c === TORRE ? "torre" : c);

function lineaDeJugada(h) {
  const verbo = h.tipo === "disparar" ? "dispara a" : h.tipo === "atacar" ? "ataca" : "va a";
  const partes = [`${CASILLA(h.desde)} ${verbo} ${CASILLA(h.hasta)}`];
  for (const e of h.eventos || []) {
    if (e.tipo === "duelo") {
      const gana = e.resultado === "atacante" ? "gana el atacante" : e.resultado === "defensor" ? "gana el defensor" : "empate, se retiran los dos";
      partes.push(`${NOMBRE_RANGO[e.atacante.rango]} contra ${NOMBRE_RANGO[e.defensor.rango]}: ${gana}`);
    }
    if (e.tipo === "cañonazo") partes.push(`cañonazo sobre ${NOMBRE_RANGO[e.objetivo.rango]}`);
    if (e.tipo === "bandera-recogida") partes.push("recoge una bandera");
    if (e.tipo === "bandera-soltada") partes.push("suelta la bandera");
    if (e.tipo === "victoria") partes.push("CORONA Y GANA");
  }
  return partes.join(" · ");
}

// --- El documento entero ------------------------------------------------------

export function construirInforme(sala) {
  const estado = sala.estado || {};
  const historia = estado.historia || [];
  const despliegues = sala.despliegues || {};
  const fin = estado.fin || {};
  const colores = Object.keys(ESTILO);

  const resultado = fin.ganador
    ? `Ganan ${fin.equipo.join(" y ")}, con la bandera ${fin.bandera || fin.ganador}`
    : `Sin ganador${fin.motivo ? `: ${fin.motivo}` : ""}`;

  const cuentaPorColor = (color) => historia.filter((h) => h.color === color).length;
  const bajasPorColor = (color) =>
    historia.reduce((n, h) => n + (h.eventos || []).filter((e) =>
      (e.tipo === "duelo" && ((e.resultado === "atacante" && e.defensor.color === color) || (e.resultado === "defensor" && e.atacante.color === color) || e.resultado === "empate" && (e.atacante.color === color || e.defensor.color === color))) ||
      (e.tipo === "cañonazo" && e.objetivo.color === color)
    ).length, 0);

  const seccionColor = (color) => `
    <section class="bando">
      <h3><span class="sello" style="background:${ESTILO[color].css}"></span>${color} <small>${ESTILO[color].lado}</small></h3>
      <div class="par">
        <figure><figcaption>Despliegue inicial</figcaption>${diagramaDeDespliegue(color, despliegues[color])}</figure>
        <figure><figcaption>Por dónde se movió</figcaption>${diagramaDeMovimientos(color, historia)}</figure>
      </div>
    </section>`;

  const filas = historia
    .map((h) => `<tr><td class="n">${h.n}</td><td><span class="sello peq" style="background:${ESTILO[h.color] ? ESTILO[h.color].css : "#999"}"></span>${esc(h.color)}</td><td>${esc(lineaDeJugada(h))}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<title>Reuter4 · ${esc(sala.nombre || "partida")}</title>
<style>
  :root { --tinta:#2b2620; --tenue:#7a7060; --linea:#ded5c4; --papel:#fffdf8; }
  * { box-sizing: border-box; }
  body { margin:0; padding:28px; background:var(--papel); color:var(--tinta);
         font:15px/1.55 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; }
  h1 { font-size:27px; margin:0 0 2px; letter-spacing:-0.01em; }
  h2 { font-size:19px; margin:34px 0 12px; padding-bottom:5px; border-bottom:1px solid var(--linea); }
  h3 { font-size:16px; margin:0 0 10px; display:flex; align-items:center; gap:8px; text-transform:capitalize; }
  h3 small { color:var(--tenue); font-weight:400; text-transform:none; }
  .sub { color:var(--tenue); margin:0 0 18px; }
  .sello { width:13px; height:13px; border-radius:50%; display:inline-block; }
  .sello.peq { width:9px; height:9px; margin-right:6px; vertical-align:middle; }
  .fichas { display:flex; flex-wrap:wrap; gap:10px; margin:0 0 8px; padding:0; }
  .ficha { border:1px solid var(--linea); border-radius:6px; padding:8px 12px; min-width:118px; }
  .ficha dt { font-size:11px; color:var(--tenue); text-transform:uppercase; letter-spacing:0.06em; }
  .ficha dd { margin:2px 0 0; font-size:19px; font-variant-numeric:tabular-nums; }
  .bando { margin:0 0 26px; break-inside:avoid; }
  .par { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  figure { margin:0; }
  figcaption { font-size:12px; color:var(--tenue); margin-bottom:5px; }
  .pie { font-size:11px; color:var(--tenue); margin:5px 0 0; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--linea); vertical-align:top; }
  td.n { color:var(--tenue); font-variant-numeric:tabular-nums; width:44px; }
  thead th { font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--tenue); }
  .barra { position:sticky; top:0; background:var(--papel); padding:0 0 14px; }
  button { font:inherit; padding:7px 15px; border:1px solid var(--tinta); background:var(--tinta);
           color:var(--papel); border-radius:5px; cursor:pointer; }
  @media print { .barra { display:none; } body { padding:0; } .bando { break-inside:avoid; } }
</style></head><body>
  ${definicionDelTablero()}
  <div class="barra"><button onclick="window.print()">Imprimir o guardar en PDF</button></div>
  <h1>${esc(sala.nombre || "Partida")}</h1>
  <p class="sub">${esc(resultado)} · ${historia.length} jugadas · ${new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}</p>

  <dl class="fichas">
    ${colores.map((c) => `<div class="ficha"><dt>${c}</dt><dd>${cuentaPorColor(c)}<small style="font-size:12px;color:var(--tenue)"> jugadas · ${bajasPorColor(c)} bajas</small></dd></div>`).join("")}
  </dl>

  <h2>Los cuatro ejércitos</h2>
  ${colores.map(seccionColor).join("")}

  <h2>El hilo completo</h2>
  <table><thead><tr><th>#</th><th>bando</th><th>jugada</th></tr></thead><tbody>${filas}</tbody></table>
</body></html>`;
}

// Abre el informe en una pestaña nueva. Devuelve false si el navegador la ha
// bloqueado, para que quien llama pueda avisar en vez de no hacer nada.
export function abrirInforme(sala) {
  const ventana = window.open("", "_blank");
  if (!ventana) return false;
  ventana.document.write(construirInforme(sala));
  ventana.document.close();
  return true;
}
