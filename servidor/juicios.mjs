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
import { rasgosDeDespliegue, FIRMA as FIRMA_DESPLIEGUE } from "../src/motor/rasgos-despliegue.js";
import { evaluar } from "../src/motor/red.js";
import { generador } from "../entrenamiento/arena.mjs";
import { puntuarAcciones, DISTANCIA } from "../src/motor/bot.js";
import { analizarTurno } from "../src/motor/analisis.js";
import { rasgosDeJugada, contextoDeTurno, FIRMA as FIRMA_JUGADA } from "../src/motor/rasgos-jugada.js";
import { NOMBRE_RANGO, ESTILO } from "../src/estilo.js";
import { leerBanco, claveDeJuicio } from "../entrenamiento/escenarios.mjs";
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
const JUICIOS_JUGADA = path.join(CARPETA, "juicios.json");
const CANDIDATAS = 4;

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
// atención humana y es lo más caro que produce esta herramienta: un modelo se
// rehace entrenando otra vez, una tarde de valorar no.
export function reiniciarJuicios(cual = "posiciones") {
  const ruta = cual === "jugadas" ? JUICIOS_JUGADA : JUICIOS;
  const leer = cual === "jugadas" ? leerJuiciosJugada : leerJuicios;
  const antes = Object.keys(leer()).length;
  if (fs.existsSync(ruta) && antes) {
    const sello = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    fs.copyFileSync(ruta, ruta.replace(/\.json$/, `-${sello}.json`));
  }
  fs.mkdirSync(CARPETA, { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify({ creado: new Date().toISOString(), juicios: {} }, null, 1));
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

// --- Juicios de jugada --------------------------------------------------------
//
// El mismo mecanismo sobre una jugada dentro de una posición. La diferencia con
// los despliegues no es de forma sino de alcance: una jugada solo existe dentro
// de SU posición, así que aquí no se puede cruzar nada entre casos. Cien
// posiciones no pueden gobernar una política de cuatrocientas decisiones por
// partida, y por eso estos pesan menos en el conjunto.

export function leerJuiciosJugada() {
  if (!fs.existsSync(JUICIOS_JUGADA)) return {};
  try { return JSON.parse(fs.readFileSync(JUICIOS_JUGADA, "utf8")).juicios || {}; } catch { return {}; }
}

function escribirJuiciosJugada(juicios) {
  fs.mkdirSync(CARPETA, { recursive: true });
  fs.writeFileSync(JUICIOS_JUGADA, JSON.stringify({ creado: new Date().toISOString(), juicios }, null, 1));
}

export function construirCasos(redJugada) {
  const banco = leerBanco();
  return banco.map((esc, i) => {
    const azar = generador(9000 + i);
    const puntuadas = puntuarAcciones(esc.estado, esc.color, { azar });
    const mejores = puntuadas.slice(0, Math.max(0, CANDIDATAS - 1)).map((p) => p.accion);
    // Una del montón: sin alguna mala no hay contraste que juzgar.
    if (puntuadas.length > CANDIDATAS) mejores.push(puntuadas[puntuadas.length - 1].accion);

    // Lo que piensa la red, calculado aquí pero que la página NO enseña hasta
    // que hayas juzgado: verlo antes lo convierte en un asentimiento.
    let suyo = null;
    if (redJugada && mejores.length) {
      const contexto = contextoDeTurno(esc.estado, esc.color, analizarTurno(esc.estado, esc.color, DISTANCIA));
      const notas = mejores.map((a) => evaluar(redJugada, rasgosDeJugada(esc.estado, esc.color, a, contexto)));
      const orden = notas.map((n, k) => ({ n, k })).sort((a, b) => b.n - a.n).map((x) => x.k);
      suyo = { notas: notas.map((n) => Number(n.toFixed(4))), puesto: mejores.map((_, k) => orden.indexOf(k)) };
    }
    return {
      i, motivo: esc.motivo, color: esc.color, estado: esc.estado, acciones: mejores,
      claves: mejores.map((a) => claveDeJuicio(esc.estado, esc.color, a)),
      suyo,
    };
  }).filter((c) => c.acciones.length >= 2);
}

// --- Estado de las redes ------------------------------------------------------
//
// Para no tener que preguntar "¿cómo van las redes?" cada vez. Dice qué hay
// publicado, si hay algo entrenando AHORA MISMO -que es cuando los números están
// cambiando debajo y no hay que fiarse de ellos- y cuánto puede quedar.

function leerModelo(carpeta, fichero, firmaEsperada) {
  const ruta = path.join(RAIZ, carpeta, fichero);
  if (!fs.existsSync(ruta)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(ruta, "utf8"));
    return {
      // UN MODELO CON OTRA FIRMA NO ES "PEOR", ES INSERVIBLE: se cargaría sin dar
      // error y jugaría con basura. Un 93% de victorias medido con otros rasgos
      // no significa nada hoy, así que la página tiene que decirlo y no
      // enseñarlo como si estuviera al día.
      alDia: d.firmaRasgos === firmaEsperada,
      capas: d.red ? d.red.capas : null,
      victorias: d.victoriasEnJuego ?? null,
      perdida: d.perdidaValidacion ?? null,
      firma: d.firmaRasgos || null,
      activacion: d.activacion || null,
      creado: d.creado || null,
      juiciosAlEntrenar: d.juiciosAlEntrenar || null,
      juiciosUsados: d.juiciosUsados ?? null,
      aciertoEnJuiciosApartados: d.aciertoEnJuiciosApartados ?? null,
    };
  } catch {
    return null;
  }
}

async function entrenando() {
  try {
    const { stdout } = await ejecutar("ps", ["-Ao", "pid,etime,command"], { maxBuffer: 8 * 1024 * 1024 });
    const lineas = stdout.split("\n").filter((l) =>
      /entrenamiento\/(coevolucion|entrenar-jugada|entrenar-despliegue|destilar|nocturno)\.mjs/.test(l));
    return lineas.map((l) => {
      const m = l.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
      if (!m) return null;
      const cual = (m[3].match(/entrenamiento\/(\w[\w-]*)\.mjs/) || [, "?"])[1];
      return { pid: Number(m[1]), desde: m[2], que: cual };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// Cuánto puede quedar: se saca de lo que han tardado las sesiones ya hechas, no
// de una estimación inventada. Si aún no ha terminado ninguna, se dice que no
// se sabe en vez de dar un número que no significa nada.
function marchaDelNocturno() {
  const ruta = path.join(RAIZ, "entrenamiento", "modelos", "nocturno.json");
  if (!fs.existsSync(ruta)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(ruta, "utf8"));
    const hechas = (d.sesiones || []).filter((s) => s.minutos);
    if (!hechas.length) return { sesiones: (d.sesiones || []).length, mejor: d.mejor ?? null, minutosPorSesion: null };
    const media = hechas.reduce((a, s) => a + s.minutos, 0) / hechas.length;
    return {
      sesiones: d.sesiones.length,
      mejor: d.mejor ?? null,
      minutosPorSesion: Math.round(media),
      ultima: d.sesiones[d.sesiones.length - 1],
      adoptadasTotales: d.sesiones.reduce((a, s) => a + (s.adoptadas || 0), 0),
      // Cuándo acabó la última: con eso y lo que tarda una sesión se sabe por
      // dónde va la que está corriendo ahora.
      finUltima: d.sesiones[d.sesiones.length - 1].cuando || null,
    };
  } catch {
    return null;
  }
}

export async function estadoDeLasRedes() {
  return {
    publicadas: {
      jugada: leerModelo(path.join("src", "motor", "modelos"), "red-jugada.json", FIRMA_JUGADA),
      despliegue: leerModelo(path.join("src", "motor", "modelos"), "red-despliegue.json", FIRMA_DESPLIEGUE),
    },
    taller: {
      jugada: leerModelo(path.join("entrenamiento", "modelos"), "red-jugada.json", FIRMA_JUGADA),
      despliegue: leerModelo(path.join("entrenamiento", "modelos"), "red-despliegue.json", FIRMA_DESPLIEGUE),
    },
    entrenando: await entrenando(),
    nocturno: marchaDelNocturno(),
    hayInforme: fs.existsSync(path.join(RAIZ, "docs", "index.html")),
  };
}

// --- El plot de una red -------------------------------------------------------

const REDES = {
  jugada: { fichero: "red-jugada.json", titulo: "Red de jugada", pie: "decide cada movimiento" },
  despliegue: { fichero: "red-despliegue.json", titulo: "Red de despliegue", pie: "elige la posición de salida" },
};

export async function paginaDeRed(cual) {
  const cfg = REDES[cual];
  if (!cfg) return null;
  const ruta = path.join(RAIZ, "entrenamiento", "modelos", cfg.fichero);
  if (!fs.existsSync(ruta)) return `<p>Todavía no hay nada entrenado para ${cual}.</p>`;

  const guardado = JSON.parse(fs.readFileSync(ruta, "utf8"));
  const { diagramaDeRed } = await import("../entrenamiento/informe-redes.mjs");
  const { desdeObjeto } = await import("../src/motor/red.js");
  const { ablacion, linealidad } = await import("../entrenamiento/uso-de-red.mjs");
  const { entradasDeJugada, entradasDeDespliegue } = await import("../entrenamiento/sensibilidad.mjs");

  const red = desdeObjeto(guardado.red);
  const nombres = cual === "jugada"
    ? (await import("../src/motor/rasgos-jugada.js")).NOMBRES
    : await (async () => {
        const { nombreDeRasgo, TAMANO } = await import("../src/motor/rasgos-despliegue.js");
        return Array.from({ length: TAMANO }, (_, i) => nombreDeRasgo(i));
      })();

  // Pocas muestras a propósito: esta página tiene que abrirse al momento. Para
  // la medida fina está el informe completo.
  let uso = "";
  try {
    const vectores = cual === "jugada" ? entradasDeJugada({ partidas: 3 }) : entradasDeDespliegue({ muestras: 200 });
    const a = ablacion(red, vectores);
    const l = linealidad(red, vectores);
    uso = `<dl class="fichas">
      <div class="ficha"><dt>neuronas que hacen algo</dt><dd>${a.utiles}<small> de ${a.ocultas}</small></dd></div>
      <div class="ficha"><dt>inertes</dt><dd>${a.inertes}<small> de ${a.ocultas}</small></dd></div>
      <div class="ficha"><dt>R² de la mejor recta</dt><dd>${l.r2.toFixed(4)}</dd></div>
      <div class="ficha"><dt>ordena como una recta</dt><dd>${(l.ordenIgual * 100).toFixed(1)}%</dd></div>
    </dl>
    <p class="nota"><b>Ordenar como una recta NO significa que las capas ocultas sobren.</b> Se
    comprobó construyendo la red lineal equivalente y haciéndola jugar: la de despliegue sí sobra
    —90,0% contra 90,4%, indistinguible— pero la de jugada ordena igual que una recta el 95% de
    los pares y aun así juega cuarenta puntos peor al sustituirla. Ese 5% no está repartido: está
    justo donde se decide, porque elegir jugada es coger el máximo de unas cincuenta opciones y
    basta con equivocarse en las de arriba.<br>
    Lo que sí se sostiene es que sobra TAMAÑO: apagando neuronas de la menos útil a la más útil,
    la red de jugada llega al 90,4% con solo 6 de sus 28.<br>
    Medido sobre ${vectores.length} entradas, pocas para que esta página abra al momento.</p>`;
  } catch {
    uso = `<p class="nota">No se ha podido medir el uso de la red.</p>`;
  }

  const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Reuter4 · ${cfg.titulo}</title><style>
 :root { --tinta:#2b2620; --tenue:#7a7060; --linea:#ded5c4; --papel:#fffdf8; --laton:#8A6420;
         --suelo:#EDE4D2; --apagado:#6E6045; --filo:#ded5c4; --bien:#4A7C4A; --mal:#96362C;
         --dato:#6FA8C7; --tabla:#fff; }
 * { box-sizing:border-box; }
 body { margin:0; padding:26px 24px 60px; background:var(--papel); color:var(--tinta);
        font:15.5px/1.6 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; }
 .hoja { max-width:820px; margin:0 auto; }
 h1 { font-size:26px; margin:0 0 2px; }
 .sub { color:var(--tenue); font-size:14px; margin:0 0 20px; }
 .fichas { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px;
           margin:0 0 18px; padding:0; }
 .ficha { border:1px solid var(--linea); border-radius:6px; padding:11px 13px; background:#fff; }
 .ficha dt { font:500 10px/1.3 ui-monospace,monospace; letter-spacing:.08em;
             text-transform:uppercase; color:var(--tenue); }
 .ficha dd { margin:5px 0 0; font:600 22px/1 ui-monospace,monospace; }
 .ficha dd small { font-size:12px; font-weight:400; color:var(--tenue); }
 .lienzo { background:#fff; border:1px solid var(--linea); border-radius:6px; padding:12px;
           overflow-x:auto; margin:0 0 14px; }
 .nota { font-size:13px; color:var(--tenue); border-left:2px solid var(--linea);
         padding-left:12px; max-width:66ch; }
 a.boton { font:inherit; font-size:14px; padding:7px 16px; border:1px solid var(--linea);
           background:#fff; color:var(--tinta); border-radius:6px; text-decoration:none;
           display:inline-block; margin-top:16px; }
 a.boton:hover { border-color:var(--tinta); }
</style></head><body><div class="hoja">
<h1>${cfg.titulo}</h1>
<p class="sub">${cfg.pie} · ${guardado.red.capas.join("-")} · ${pct(guardado.victoriasEnJuego)} de victorias · ${(guardado.creado || "").slice(0, 16).replace("T", " ")}</p>
${uso}
<div class="lienzo">${diagramaDeRed(red, nombres, { ancho: 780, alto: 340 })}</div>
<p class="nota">Cada franja de la izquierda es una entrada, tanto más oscura cuanto más reparte.
Los círculos son las neuronas ocultas: el <b>color</b> es lo que les entra —cuánto miran— y el
<b>tamaño</b> lo que sacan hacia la salida —cuánto se les hace caso—. Una grande y pálida mira
poco pero decide mucho. Solo se dibujan las conexiones más fuertes: con
${guardado.red.capas[0] * (guardado.red.capas[1] || 0)} el dibujo sería un borrón.</p>
<a class="boton" href="/juicios">volver al taller</a>
</div></body></html>`;
}

// --- Estado del taller --------------------------------------------------------

// Cuántas quedan por valorar. Hace falta construir las parejas y los casos, que
// no es gratis, así que van por la misma caché que sirve a las páginas: la
// primera llamada las construye y las demás las encuentran hechas.
function pendientes(red, redJugada) {
  const juicios = leerJuicios();
  if (!cache.parejas) cache.parejas = construirParejas(red);
  const posiciones = cache.parejas.parejas.filter((p) => !juicios[`${p.a.clave}|${p.b.clave}`]).length;

  const deJugada = leerJuiciosJugada();
  if (!cache.casos) cache.casos = construirCasos(redJugada);
  // Un caso sigue pendiente mientras le quede alguna candidata sin juzgar: el
  // valor está en el contraste entre ellas, y con la mitad juzgada no hay orden
  // completo que aprender.
  // TODO EN JUGADAS, no en escenarios. Mezclar las dos unidades en la misma fila
  // -"342 escenarios sin valorar" junto a "837 jugadas valoradas"- obliga a
  // saber que un escenario tiene cuatro candidatas para poder comparar los dos
  // números. Se cuenta en candidatas, que es lo que de verdad se juzga.
  let candidatas = 0;
  let candidatasSinJuzgar = 0;
  for (const c of cache.casos) {
    candidatas += c.claves.length;
    candidatasSinJuzgar += c.claves.filter((k) => !deJugada[k]).length;
  }

  return {
    posiciones, jugadas: candidatasSinJuzgar, candidatas,
    // Los totales de los que salen esos pendientes. Sin ellos, "111 sin valorar"
    // no se puede comparar con nada: no son 111 de los 8 despliegues del pozo ni
    // de los 132 juicios guardados, son 111 de las 120 PAREJAS que se ofrecen.
    parejas: cache.parejas.parejas.length,
    escenarios: cache.casos.length,
  };
}

export function estado(red, redJugada) {
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
  const deJugada = leerJuiciosJugada();

  // CUÁNTO DE LO VALORADO YA HA ENTRENADO. Cada modelo publicado guarda cuántos
  // juicios había cuando se entrenó; lo hecho después todavía no ha cambiado
  // cómo juegan los bots. Valorar sin entrenar no sirve de nada, y sin este
  // número no había forma de verlo.
  const entrenados = (fichero, firma) => {
    const m = leerModelo(path.join("src", "motor", "modelos"), fichero, firma);
    return (m && m.juiciosAlEntrenar) || null;
  };
  const conDespliegue = entrenados("red-despliegue.json", FIRMA_DESPLIEGUE);
  const conJugada = entrenados("red-jugada.json", FIRMA_JUGADA);

  return {
    archivadas,
    cosechadas,
    entrenadosDespliegue: conDespliegue ? conDespliegue.despliegue : 0,
    entrenadosJugada: conJugada ? conJugada.jugada : 0,
    jugadasJuzgadas: Object.keys(deJugada).length,
    enElBanco: leerBanco().length,
    sinCosechar: Math.max(0, archivadas - cosechadas),
    enElPozo: COLORES.reduce((n, c) => n + pozo[c].length, 0),
    juzgados: Object.keys(juicios).length,
    conOrden: Object.values(juicios).filter((v) => v === "a" || v === "b").length,
    pendientes: pendientes(red, redJugada),
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

// Publicar: llevar lo del taller a donde lo cogen los bots. Sigue siendo un paso
// EXPLÍCITO -el nocturno entrena solo pero no publica nunca-, solo que ahora se
// puede pedir desde aquí en vez de desde un terminal. El script decide: rechaza
// un modelo con otra firma de rasgos y no publica si no mejora.
export async function publicar({ solo = null, forzar = false } = {}) {
  const args = [path.join(RAIZ, "herramientas", "publicar-redes.mjs")];
  if (solo) args.push("--solo", solo);
  if (forzar) args.push("--forzar");
  try {
    const r = await ejecutar("node", args, {
      cwd: RAIZ, maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, salida: r.stdout.trim() };
  } catch (e) {
    return { ok: false, salida: String(e.stdout || e.message).trim() };
  }
}

// RESET: dejar la red del taller como recién nacida, con pesos al azar. No es
// "entrenarla de cero" —eso lo hace el entrenamiento— sino borrarle lo aprendido
// para que el siguiente entrenamiento no arrastre nada. Recién reseteada juega
// fatal, así que publicarla es sustituir la buena por una que no sabe jugar; se
// avisa antes y hace falta forzar.
export async function resetear(cual) {
  const REDES = {
    jugada: { fichero: "red-jugada.json", firma: FIRMA_JUGADA },
    despliegue: { fichero: "red-despliegue.json", firma: FIRMA_DESPLIEGUE },
  };
  const cfg = REDES[cual];
  if (!cfg) return { ok: false, salida: `no hay ninguna red que se llame ${cual}` };
  const ruta = path.join(RAIZ, "entrenamiento", "modelos", cfg.fichero);
  if (!fs.existsSync(ruta)) return { ok: false, salida: "no hay nada en el taller que resetear" };

  try {
    const { crearRed, aObjeto, ACTIVACION } = await import("../entrenamiento/red.mjs");
    const viejo = JSON.parse(fs.readFileSync(ruta, "utf8"));
    const capas = viejo.red.capas;
    // Copia con fecha: un modelo se rehace entrenando, pero si el reset fue un
    // resbalón conviene poder volver sin esperar una noche.
    const sello = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    fs.copyFileSync(ruta, ruta.replace(/\.json$/, `-antes-del-reset-${sello}.json`));

    let semilla = Date.now() >>> 0;
    const azar = () => ((semilla = (semilla * 1664525 + 1013904223) >>> 0) / 4294967296);
    fs.writeFileSync(ruta, JSON.stringify({
      firmaRasgos: cfg.firma,
      activacion: ACTIVACION,
      creado: new Date().toISOString(),
      origen: "reset: pesos al azar, sin entrenar",
      victoriasEnJuego: null,
      red: aObjeto(crearRed(capas, azar)),
    }, null, 1));
    return { ok: true, salida: `Red de ${cual} reseteada: ${capas.join("-")} con pesos al azar.\nEl anterior queda copiado con la fecha en entrenamiento/modelos/.` };
  } catch (e) {
    return { ok: false, salida: String(e.message) };
  }
}

// --- Las rutas ----------------------------------------------------------------

const PAGINAS = {
  "/juicios": "juicios.html",
  "/juicios/": "juicios.html",
  "/juicios/despliegues": "juzgar-despliegues.html",
  "/juicios/jugadas": "juzgar.html",
};

// Devuelve true si ha atendido la petición.
export function atender(peticion, respuesta, url, red, redJugada, alPublicar) {
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

  if (url === "/juicios/api/estado") { enviarJson(estado(red, redJugada)); return true; }

  if (url === "/juicios/api/redes") {
    estadoDeLasRedes().then((r) => enviarJson(r));
    return true;
  }

  // El informe completo, servido desde el taller para no tener que abrirlo a
  // mano. Es el fichero que genera `npm run informe-redes`.
  if (url === "/juicios/informe") {
    const informe = path.join(RAIZ, "docs", "index.html");
    if (!fs.existsSync(informe)) {
      respuesta.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      respuesta.end("<p>Todavía no hay informe. Genéralo con <code>npm run informe-redes</code>.</p>");
      return true;
    }
    respuesta.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    respuesta.end(fs.readFileSync(informe));
    return true;
  }

  // El plot de UNA red, suelto. El informe completo tarda en generarse porque
  // juega partidas para la sensibilidad; esto solo dibuja los pesos, que ya
  // están en el fichero, así que sale al momento y sirve para mirar cómo va
  // cambiando la forma de la red durante un entrenamiento.
  if (url.startsWith("/juicios/red/")) {
    const cual = url.slice("/juicios/red/".length);
    paginaDeRed(cual).then((html) => {
      respuesta.writeHead(html ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
      respuesta.end(html || "<p>No hay ninguna red con ese nombre.</p>");
    });
    return true;
  }

  if (url === "/juicios/api/casos") {
    if (!cache.casos) cache.casos = construirCasos(redJugada);
    enviarJson({ casos: cache.casos, juicios: leerJuiciosJugada(), rangos: NOMBRE_RANGO, estilo: ESTILO });
    return true;
  }

  if (url === "/juicios/api/juicio-jugada" && peticion.method === "POST") {
    let cuerpo = "";
    peticion.on("data", (t) => { cuerpo += t; if (cuerpo.length > 1e6) peticion.destroy(); });
    peticion.on("end", () => {
      try {
        const { clave, veredicto } = JSON.parse(cuerpo);
        const juicios = leerJuiciosJugada();
        juicios[clave] = veredicto;
        escribirJuiciosJugada(juicios);
        enviarJson({ ok: true, total: Object.keys(juicios).length });
      } catch (e) { enviarJson({ error: String(e.message) }, 400); }
    });
    return true;
  }

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

  if (url.startsWith("/juicios/api/reiniciar") && peticion.method === "POST") {
    const cual = url.endsWith("/jugadas") ? "jugadas" : "posiciones";
    enviarJson({ ok: true, cual, ...reiniciarJuicios(cual) });
    return true;
  }

  if (url.startsWith("/juicios/api/reset/") && peticion.method === "POST") {
    resetear(url.slice("/juicios/api/reset/".length)).then((r) => {
      cache.parejas = null;
      cache.casos = null;
      enviarJson(r);
    });
    return true;
  }

  // BACKUP: el modelo publicado tal cual, para guardarlo fuera. Solo el
  // publicado: el del taller cambia con cada entrenamiento y no vale como copia.
  if (url.startsWith("/juicios/api/copia/")) {
    const cual = url.slice("/juicios/api/copia/".length);
    const fichero = cual === "jugada" ? "red-jugada.json" : cual === "despliegue" ? "red-despliegue.json" : null;
    const ruta = fichero && path.join(RAIZ, "src", "motor", "modelos", fichero);
    if (!ruta || !fs.existsSync(ruta)) { respuesta.writeHead(404).end("no hay nada publicado"); return true; }
    const sello = new Date().toISOString().slice(0, 10);
    respuesta.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="reuter4-${cual}-${sello}.json"`,
    });
    fs.createReadStream(ruta).pipe(respuesta);
    return true;
  }

  if (url.startsWith("/juicios/api/publicar") && peticion.method === "POST") {
    const resto = url.slice("/juicios/api/publicar".length).replace(/^\//, "");
    const [cual, modo] = resto.split("/");
    publicar({ solo: cual || null, forzar: modo === "forzar" }).then((r) => {
      // Que los bots cojan las redes nuevas SIN reiniciar. Sin esto el botón
      // mentiría: diría "publicado" y las partidas seguirían jugándose con lo
      // de antes hasta el siguiente arranque.
      if (r.ok && typeof alPublicar === "function") alPublicar();
      cache.parejas = null;
      cache.casos = null;
      enviarJson(r);
    });
    return true;
  }

  if (url === "/juicios/api/cosechar" && peticion.method === "POST") {
    cosechar().then((r) => {
      // Lo cosechado entra en las parejas, así que hay que rehacerlas.
      cache.parejas = construirParejas(red);
      // Lo cosechado también entra en el banco de escenarios, así que los casos
      // de jugada se rehacen igual.
      cache.casos = null;
      enviarJson({ ...r, estado: estado(red, redJugada), hayJugados: cache.parejas.hayJugados });
    });
    return true;
  }

  respuesta.writeHead(404).end("no existe");
  return true;
}

// Las parejas se construyen una vez y se guardan: generarlas cuesta correr el
// despliegue guiado ciento veinte veces, y además tienen que ser LAS MISMAS
// entre recargas de la página o el juicio cambiaría de objeto a media tanda.
const cache = { parejas: null, casos: null };
export function olvidarParejas() { cache.parejas = null; cache.casos = null; }
