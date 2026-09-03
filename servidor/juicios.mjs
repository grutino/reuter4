// El taller de juicios, servido por el propio juego.
//
// POR QUÉ AQUÍ Y NO EN UNA HERRAMIENTA SUELTA. El circuito que interesa es
// jugar -> mirar lo que salió -> valorarlo -> que las redes aprendan de eso, y
// ese circuito se rompe en cuanto un tramo exige abrir un terminal. Con las
// herramientas en `herramientas/` había que acordarse de `npm run cosechar` y de
// `npm run juzgar-despliegues` con la partida ya cerrada y olvidada.
//
// Así que la lógica vive aquí, el servidor del juego la monta en /juicios, y las
// herramientas de `herramientas/` quedan como lanzadores del mismo código en su
// propio puerto, para quien prefiera el terminal.
//
// LO QUE NO SE HACE AQUÍ: entrenar. Un entrenamiento son horas de CPU y no puede
// colgar del servidor que está repartiendo una partida. Esta página recoge el
// material y dice qué falta; entrenar sigue siendo `npm run nocturno`.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { COLORES } from "../src/motor/tablero.js";
import { despliegueAleatorio } from "../src/motor/bot.js";
import { despliegueGuiado } from "../src/motor/bot-red.js";
import { rasgosDeDespliegue } from "../src/motor/rasgos-despliegue.js";
import { evaluar } from "../src/motor/red.js";
import { generador } from "../entrenamiento/arena.mjs";
import { cargarAperturas } from "../entrenamiento/panel.mjs";
import { aColocacion, variar, guiada } from "../entrenamiento/aperturas.mjs";

const ejecutar = promisify(execFile);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");
const CARPETA = path.join(RAIZ, "entrenamiento", "escenarios");
const JUICIOS = path.join(CARPETA, "juicios-despliegue.json");
const POZO = path.join(CARPETA, "despliegues-jugados.json");
const PARTIDAS = path.join(RAIZ, "partidas");
const CUANTOS = 120;

// --- Lo juzgado ---------------------------------------------------------------

export function leerJuicios() {
  if (!fs.existsSync(JUICIOS)) return {};
  try { return JSON.parse(fs.readFileSync(JUICIOS, "utf8")).juicios || {}; } catch { return {}; }
}

function escribirJuicios(juicios) {
  fs.mkdirSync(CARPETA, { recursive: true });
  fs.writeFileSync(JUICIOS, JSON.stringify({ creado: new Date().toISOString(), juicios }, null, 1));
}

// Se BORRA lo juzgado, pero antes se guarda copia con la fecha. Un juicio cuesta
// atención humana y es lo más caro que produce esta herramienta.
export function reiniciarJuicios() {
  const antes = Object.keys(leerJuicios()).length;
  if (fs.existsSync(JUICIOS) && antes) {
    const sello = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    fs.copyFileSync(JUICIOS, JUICIOS.replace(/\.json$/, `-${sello}.json`));
  }
  escribirJuicios({});
  return { apartados: antes };
}

// --- Las parejas --------------------------------------------------------------

// La clave identifica la COLOCACIÓN, no su sitio en una lista: las parejas se
// regeneran y con índices los juicios apuntarían a otra cosa. El separador no es
// cosmético: la casilla acaba en dígito y el rango ES un dígito, así que "E13"
// pegado a un 2 se lee igual como (E13, 2) que como (E1, 32).
export function claveDe(color, colocacion) {
  return color + ":" + colocacion.slice().sort((x, y) => (x.casilla < y.casilla ? -1 : 1)).map((p) => `${p.casilla}-${p.rango}`).join(",");
}

function leerPozo() {
  const porColor = Object.fromEntries(COLORES.map((c) => [c, []]));
  if (!fs.existsSync(POZO)) return porColor;
  try {
    for (const d of JSON.parse(fs.readFileSync(POZO, "utf8")).despliegues || []) {
      if (porColor[d.color]) porColor[d.color].push(d);
    }
  } catch {
    // Un pozo ilegible no puede impedir juzgar lo generado.
  }
  return porColor;
}

// La variedad importa: si todas las parejas salen de la misma fuente, lo que se
// aprende es a distinguir dentro de esa fuente y nada más.
function unDespliegue(color, red, humanas, jugados, tomados, azar) {
  // Mientras queden despliegues jugados sin usar de este color, se sirven ellos:
  // alguien los eligió para jugar, no salieron de un generador.
  const cola = jugados[color] || [];
  if (tomados[color] < cola.length) {
    const d = cola[tomados[color]++];
    return { colocacion: d.colocacion, origen: "jugado de verdad" };
  }
  const r = azar();
  if (humanas.length && r < 0.3) {
    const h = humanas[Math.floor(azar() * humanas.length)];
    return { colocacion: aColocacion(h.rejilla, color), origen: h.nombre };
  }
  if (humanas.length && r < 0.55) {
    const h = humanas[Math.floor(azar() * humanas.length)];
    return { colocacion: aColocacion(variar(h.rejilla, 3 + Math.floor(azar() * 8), azar), color), origen: `${h.nombre} variada` };
  }
  if (r < 0.72) return { colocacion: aColocacion(guiada(azar, 2 + Math.floor(azar() * 3), 120).rejilla, color), origen: "guiada" };
  if (r < 0.88 && red) return { colocacion: despliegueGuiado(color, azar, red, 30, 200), origen: "de la red" };
  return { colocacion: despliegueAleatorio(color, azar), origen: "al azar" };
}

// SEMILLA FIJA, no un generador que arrastra estado: así la parte generada sale
// igual siempre y al cosechar partidas nuevas lo único que cambia es que entran
// los jugados por delante. Con estado compartido, cosechar barajaba de nuevo las
// ciento veinte parejas y dejaba al que juzga sin las que ya tenía delante.
export function construirParejas(red) {
  const azar = generador(4242);
  const humanas = cargarAperturas();
  const jugados = leerPozo();
  const tomados = Object.fromEntries(COLORES.map((c) => [c, 0]));

  const parejas = Array.from({ length: CUANTOS }, (_, i) => {
    const color = COLORES[i % 4];
    const a = unDespliegue(color, red, humanas, jugados, tomados, azar);
    const b = unDespliegue(color, red, humanas, jugados, tomados, azar);
    const nota = (c) => (red ? evaluar(red, rasgosDeDespliegue(color, c)) : null);
    return {
      i, color,
      a: { ...a, clave: claveDe(color, a.colocacion) },
      b: { ...b, clave: claveDe(color, b.colocacion) },
      // Lo que opina la red, que la página NO enseña hasta que se ha juzgado:
      // sabiéndolo antes, el juicio deja de ser una opinión y pasa a ser un
      // asentimiento.
      suyo: red ? { a: Number(nota(a.colocacion).toFixed(4)), b: Number(nota(b.colocacion).toFixed(4)) } : null,
    };
  });

  return { parejas, hayJugados: COLORES.reduce((n, c) => n + jugados[c].length, 0) };
}

// --- Estado del taller --------------------------------------------------------

export function estado() {
  const archivadas = fs.existsSync(PARTIDAS)
    ? fs.readdirSync(PARTIDAS).filter((f) => f.endsWith(".json") && f !== "cosechadas.json").length
    : 0;
  let cosechadas = 0;
  const marca = path.join(PARTIDAS, "cosechadas.json");
  if (fs.existsSync(marca)) {
    try { cosechadas = (JSON.parse(fs.readFileSync(marca, "utf8")).hechas || []).length; } catch { cosechadas = 0; }
  }
  const juicios = leerJuicios();
  const pozo = leerPozo();
  return {
    archivadas,
    cosechadas,
    sinCosechar: Math.max(0, archivadas - cosechadas),
    enElPozo: COLORES.reduce((n, c) => n + pozo[c].length, 0),
    juzgados: Object.keys(juicios).length,
    conOrden: Object.values(juicios).filter((v) => v === "a" || v === "b").length,
  };
}

// La cosecha se delega al script, que es el que ya sabe hacerla. Se lanza como
// proceso aparte a propósito: si revienta, se lleva por delante su proceso y no
// el servidor que está repartiendo una partida.
export async function cosechar() {
  try {
    const r = await ejecutar("node", [path.join(RAIZ, "herramientas", "cosechar-partidas.mjs")], {
      cwd: RAIZ, maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, salida: r.stdout.trim() };
  } catch (e) {
    return { ok: false, salida: String(e.stdout || e.message).trim() };
  }
}

// --- Las rutas ----------------------------------------------------------------

const PAGINAS = {
  "/juicios": "juicios.html",
  "/juicios/": "juicios.html",
  "/juicios/despliegues": "juzgar-despliegues.html",
};

// Devuelve true si ha atendido la petición.
export function atender(peticion, respuesta, url, red) {
  if (!url.startsWith("/juicios") && !url.startsWith("/src/")) return false;

  const enviarJson = (datos, codigo = 200) => {
    respuesta.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
    respuesta.end(JSON.stringify(datos));
  };

  if (PAGINAS[url]) {
    const fichero = path.join(RAIZ, "herramientas", PAGINAS[url]);
    if (!fs.existsSync(fichero)) { respuesta.writeHead(404).end("falta la página"); return true; }
    respuesta.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    respuesta.end(fs.readFileSync(fichero, "utf8"));
    return true;
  }

  // Los módulos que la página importa tal cual. La página de juicios reutiliza
  // `informe-partida.js` para dibujar los tableros, y ese fichero -y los suyos-
  // son ESM plano sin JSX ni dependencias de node, así que el navegador los
  // carga sin compilar. Solo .js y sin salir de src/: lo que va aquí ya viaja
  // dentro del bundle del cliente, pero eso no es excusa para abrir el disco.
  if (url.startsWith("/src/")) {
    if (!url.endsWith(".js")) { respuesta.writeHead(404).end(); return true; }
    const fichero = path.join(RAIZ, url);
    const raizSrc = path.join(RAIZ, "src");
    if (!fichero.startsWith(raizSrc + path.sep) || !fs.existsSync(fichero)) {
      respuesta.writeHead(404).end();
      return true;
    }
    respuesta.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    respuesta.end(fs.readFileSync(fichero));
    return true;
  }

  if (url === "/juicios/api/estado") { enviarJson(estado()); return true; }

  if (url === "/juicios/api/parejas") {
    if (!cache.parejas) cache.parejas = construirParejas(red);
    enviarJson({ ...cache.parejas, juicios: leerJuicios() });
    return true;
  }

  if (url === "/juicios/api/juicio" && peticion.method === "POST") {
    let cuerpo = "";
    peticion.on("data", (t) => { cuerpo += t; if (cuerpo.length > 1e6) peticion.destroy(); });
    peticion.on("end", () => {
      try {
        const { clave, veredicto } = JSON.parse(cuerpo);
        const juicios = leerJuicios();
        juicios[clave] = veredicto;
        escribirJuicios(juicios);
        enviarJson({ ok: true, total: Object.keys(juicios).length });
      } catch (e) { enviarJson({ error: String(e.message) }, 400); }
    });
    return true;
  }

  if (url === "/juicios/api/reiniciar" && peticion.method === "POST") {
    enviarJson({ ok: true, ...reiniciarJuicios() });
    return true;
  }

  if (url === "/juicios/api/cosechar" && peticion.method === "POST") {
    cosechar().then((r) => {
      // Lo cosechado entra en las parejas, así que hay que rehacerlas.
      cache.parejas = construirParejas(red);
      enviarJson({ ...r, estado: estado(), hayJugados: cache.parejas.hayJugados });
    });
    return true;
  }

  respuesta.writeHead(404).end("no existe");
  return true;
}

// Las parejas se construyen una vez y se guardan: generarlas cuesta correr el
// despliegue guiado ciento veinte veces, y además tienen que ser LAS MISMAS
// entre recargas de la página o el juicio cambiaría de objeto a media tanda.
const cache = { parejas: null };
export function olvidarParejas() { cache.parejas = null; }
