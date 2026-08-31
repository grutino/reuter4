// Qué jugadas decidieron una partida.
//
// DOS ETAPAS, porque la buena es cara. La red evalúa todas las jugadas legales
// de cada posición —eso son microsegundos— y marca dónde la jugada que se hizo
// se aleja mucho de la que ella habría elegido. Solo en esos puntos se hace lo
// caro: jugar de verdad, varias veces, la jugada que se hizo y la alternativa,
// y ver si el resultado cambia.
//
// La diferencia entre las dos etapas importa: la primera dice "aquí la red no
// habría hecho eso", que puede ser un error de la red; la segunda lo mide en la
// moneda del juego. Un momento solo cuenta como decisivo si la segunda etapa lo
// confirma.
//
//   node entrenamiento/analizar-partida.mjs --simular 1
//   node entrenamiento/analizar-partida.mjs --sala <id>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES } from "../src/motor/tablero.js";
import { aplicar, reclutar, recogerLaBandera, renunciarARecoger, nuevaPartida } from "../src/motor/motor.js";
import { accionDeBot, decisionDeRecogida, despliegueAleatorio } from "../src/motor/bot.js";
import { jugadaSoloRed } from "../src/motor/bot-red.js";
import { cargarModelos } from "../src/motor/modelos.js";
import { analizarPartida, describir, resolver } from "../src/motor/analisis-partida.js";
import { generador } from "./arena.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// --- Guion --------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith("analizar-partida.mjs")) {
  const modelos = cargarModelos();
  if (!modelos.jugada) {
    console.error("Hace falta una red de jugada publicada: npm run publicar-redes");
    process.exit(1);
  }
  // Las tiradas llevan ruido a propósito: con una política determinista, pedir
  // varias calcula varias veces lo mismo.
  const jugar = (e, c, az) => jugadaSoloRed(e, c, modelos.jugada, { azar: az, ruido: 0.2 });

  const arg = (nombre, def) => {
    const i = process.argv.indexOf(`--${nombre}`);
    return i >= 0 ? process.argv[i + 1] : def;
  };

  let despliegues;
  let historia;
  const idSala = arg("sala", null);
  if (idSala) {
    const fichero = process.env.R4_ESTADO || path.join(AQUI, "..", "servidor", "salas.json");
    const salas = JSON.parse(fs.readFileSync(fichero, "utf8"));
    const sala = salas[idSala] || Object.values(salas).find((s) => s.id === idSala);
    if (!sala) { console.error(`No hay ninguna sala ${idSala} en ${fichero}`); process.exit(1); }
    if (!sala.estado || !sala.estado.fin) { console.error("Esa partida no ha terminado."); process.exit(1); }
    despliegues = sala.despliegues;
    historia = sala.estado.historia;
    console.log(`Partida "${sala.nombre}" · ${historia.length} jugadas\n`);
  } else {
    // Una partida jugada al momento, para poder probar esto sin sala guardada.
    const semilla = Number(arg("simular", 1));
    const azar = generador(9100 + semilla * 7919);
    despliegues = {};
    for (const c of COLORES) despliegues[c] = despliegueAleatorio(c, azar);
    let e = nuevaPartida(despliegues, { primero: COLORES[Math.floor(azar() * 4)] });
    let t = 0;
    while (!e.fin && t < 400) {
      if (e.pendiente) { e = resolver(e); continue; }
      const a = accionDeBot(e, e.turno, { azar });
      if (!a) break;
      e = aplicar(e, a);
      t++;
    }
    historia = e.historia;
    console.log(`Partida simulada · ${historia.length} jugadas · ${e.fin && e.fin.ganador ? `gana ${e.fin.ganador}` : "sin ganador"}\n`);
  }

  const t0 = Date.now();
  const momentos = analizarPartida(despliegues, historia, {
    red: modelos.jugada, jugar,
    cuantos: Number(arg("cuantos", 8)), tiradas: Number(arg("tiradas", 12)),
  });

  console.log("  Momentos donde la partida se decidió, de más a menos:");
  console.log("  (medir esto es ruidoso: la misma posición medida dos veces con 8 tiradas");
  console.log("   solo correlaciona 0,39 consigo misma, así que fíate de los que superan su error)\n");
  for (const m of momentos) {
    const d = describir(m);
    const signo = m.medido > 0 ? "-" : "+";
    console.log(`  jugada ${String(m.n).padStart(3)} · ${m.color}`);
    console.log(`     hizo:      ${d.jugada}`);
    console.log(`     mejor:     ${d.alternativa}`);
    const claro = Math.abs(m.medido) > 2 * m.error ? "" : "   (dentro del ruido)";
    console.log(`     medido:    ${(m.valorJugada * 100).toFixed(0)}% contra ${(m.valorAlternativa * 100).toFixed(0)}%  ` +
      `(${signo}${Math.abs(m.medido * 100).toFixed(0)} ±${Math.round(m.error * 100)} puntos)${claro}`);
  }
  console.log(`\n  ${Math.round((Date.now() - t0) / 1000)}s`);
}
