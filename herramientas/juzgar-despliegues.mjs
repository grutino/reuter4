// Sala de juicios de DESPLIEGUES: dos posiciones iniciales, ¿cuál es mejor?
//
//   npm run juzgar-despliegues
//
// POR QUÉ COMPARAR Y NO PUNTUAR. Las personas somos malas dando notas absolutas
// —"¿es prometedor?" deriva con el cansancio y con lo que se acaba de ver— y muy
// buenas comparando dos cosas. Además una comparación es exactamente lo que
// consume la pérdida por pares, sin conversiones por medio.
//
// Y POR QUÉ AQUÍ SÍ. Los juicios de JUGADA fracasaron: 103 posiciones no pueden
// gobernar una política de 400 turnos, y la red aprendió a no terminar las
// partidas. Un despliegue es otra cosa — es un objeto completo, se juzga una
// vez, y su efecto se reparte por toda la partida, así que la etiqueta es mucho
// menos ruidosa. La red de despliegue además tiene un solo objetivo por partida.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES } from "../src/motor/tablero.js";
import { despliegueAleatorio } from "../src/motor/bot.js";
import { despliegueGuiado } from "../src/motor/bot-red.js";
import { cargarModelos } from "../src/motor/modelos.js";
import { rasgosDeDespliegue } from "../src/motor/rasgos-despliegue.js";
import { evaluar } from "../src/motor/red.js";
import { generador } from "../entrenamiento/arena.mjs";
import { cargarAperturas } from "../entrenamiento/panel.mjs";
import { aColocacion, variar, guiada } from "../entrenamiento/aperturas.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CARPETA = path.join(AQUI, "..", "entrenamiento", "escenarios");
const JUICIOS = path.join(CARPETA, "juicios-despliegue.json");
const PUERTO = Number(process.env.PORT || 8124);
const CUANTOS = Number(process.argv[2] || 120);

const modelos = cargarModelos();
const humanas = cargarAperturas();
const azar = generador(4242);

// Los despliegues que han jugado partidas de verdad, cosechados de las partidas
// terminadas. Van los primeros y con prioridad: alguien —persona o red— los
// eligió para jugar, no salieron de un generador, y son los únicos sobre los que
// un juicio corrige algo que ya está ocurriendo en el tablero.
//
// El resultado de su partida está en el pozo pero NO se pasa a la página:
// sabiendo quién ganó, el juicio deja de ser una opinión sobre el despliegue y
// pasa a ser una racionalización de lo que pasó.
const POZO = path.join(CARPETA, "despliegues-jugados.json");
const jugados = (() => {
  if (!fs.existsSync(POZO)) return {};
  try {
    const todos = JSON.parse(fs.readFileSync(POZO, "utf8")).despliegues || [];
    const porColor = Object.fromEntries(COLORES.map((c) => [c, []]));
    for (const d of todos) if (porColor[d.color]) porColor[d.color].push(d);
    return porColor;
  } catch {
    return {};
  }
})();
const hayJugados = COLORES.reduce((n, c) => n + ((jugados[c] || []).length), 0);
const tomados = Object.fromEntries(COLORES.map((c) => [c, 0]));

// La variedad importa: si todas las parejas salen de la misma fuente, lo que se
// aprende es a distinguir dentro de esa fuente y nada más.
function unDespliegue(color, i) {
  // Mientras queden despliegues jugados sin usar de este color, se sirven ellos.
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
  if (r < 0.88 && modelos.despliegue) {
    return { colocacion: despliegueGuiado(color, azar, modelos.despliegue, 30, 200), origen: "de la red" };
  }
  return { colocacion: despliegueAleatorio(color, azar), origen: "al azar" };
}

// Las parejas se fijan al arrancar: así el juicio siempre es sobre las mismas
// dos, aunque se recargue la página.
const parejas = Array.from({ length: CUANTOS }, (_, i) => {
  const color = COLORES[i % 4];
  const a = unDespliegue(color, i);
  const b = unDespliegue(color, i);
  const nota = (c) => (modelos.despliegue ? evaluar(modelos.despliegue, rasgosDeDespliegue(color, c)) : null);
  return {
    i, color,
    a: { ...a, clave: claveDe(color, a.colocacion) },
    b: { ...b, clave: claveDe(color, b.colocacion) },
    // Lo que opina la red, que la página NO enseña hasta que se ha juzgado.
    suyo: modelos.despliegue ? { a: Number(nota(a.colocacion).toFixed(4)), b: Number(nota(b.colocacion).toFixed(4)) } : null,
  };
});

// La clave identifica la COLOCACIÓN, no su sitio en una lista: las parejas se
// regeneran y con índices los juicios apuntarían a otra cosa.
// El separador no es cosmético: la casilla acaba en dígito y el rango es un
// dígito, así que "E13" pegado a un 2 se lee igual como (E13, 2) que como
// (E1, 32). Con el guion la clave se puede volver a leer sin ambigüedad, que es
// lo que permite entrenar con los juicios sin arrastrar las parejas.
function claveDe(color, colocacion) {
  return color + ":" + colocacion.slice().sort((x, y) => (x.casilla < y.casilla ? -1 : 1)).map((p) => `${p.casilla}-${p.rango}`).join(",");
}

const leerJuicios = () => {
  if (!fs.existsSync(JUICIOS)) return {};
  try { return JSON.parse(fs.readFileSync(JUICIOS, "utf8")).juicios || {}; } catch { return {}; }
};

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);
  if (url.pathname === "/parejas") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ parejas, juicios: leerJuicios() }));
    return;
  }
  if (url.pathname === "/juicio" && req.method === "POST") {
    let cuerpo = "";
    req.on("data", (t) => { cuerpo += t; if (cuerpo.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try {
        const { clave, veredicto } = JSON.parse(cuerpo);
        const juicios = leerJuicios();
        juicios[clave] = veredicto;
        fs.mkdirSync(CARPETA, { recursive: true });
        fs.writeFileSync(JUICIOS, JSON.stringify({ creado: new Date().toISOString(), juicios }, null, 1));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, total: Object.keys(juicios).length }));
      } catch (e) { res.writeHead(400); res.end(String(e.message)); }
    });
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(path.join(AQUI, "juzgar-despliegues.html"), "utf8"));
    return;
  }
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
  console.log(`Juicios de despliegue en http://localhost:${PUERTO}`);
  console.log(`  ${parejas.length} parejas · ${Object.keys(leerJuicios()).length} ya juzgadas`);
  console.log(`  ${modelos.despliegue ? "con red publicada: se podrá comparar tu juicio con el suyo" : "sin red publicada"}`);
  console.log(hayJugados
    ? `  ${hayJugados} despliegues de partidas jugadas, servidos los primeros`
    : `  ningún despliegue de partida real (node herramientas/cosechar-partidas.mjs)`);
  console.log(`  Ctrl+C para parar.`);
});
