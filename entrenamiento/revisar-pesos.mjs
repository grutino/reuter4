// Revisión de pesos: la tabla que hace falta para decidir a mano qué hacer con
// cada término de la heurística.
//
// Un peso puede salir del entrenamiento con un valor disparatado por dos
// motivos muy distintos, y desde fuera se parecen:
//
//   · porque el juego premia de verdad algo que no esperábamos, o
//   · porque ese término casi nunca entra en juego, la selección no lo sujeta
//     y deriva sin control.
//
// Lo que los separa es la frecuencia de activación, y eso hay que medirlo
// jugando. Aquí se juegan partidas contando cuántas veces se activa cada
// término, y se cruza con la dispersión del peso entre los entrenamientos
// guardados: poca activación y mucha dispersión entre semillas es deriva.
//
// Uso: node entrenamiento/revisar-pesos.mjs [partidas]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES } from "../src/motor/tablero.js";
import {
  nuevaPartida,
  aplicar,
  reclutar,
  recogerLaBandera,
  renunciarARecoger,
} from "../src/motor/motor.js";
import { accionDeBot, decisionDeRecogida, despliegueAleatorio, PESOS_BASE } from "../src/motor/bot.js";
import { generador } from "./arena.mjs";
import { ESCALAS, GENES } from "./genoma.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

function contarActivaciones(pesos, partidas, limite = 400) {
  const contador = {};
  let jugadas = 0;
  for (let i = 0; i < partidas; i++) {
    const azar = generador(4242 + i * 7919);
    let estado = nuevaPartida(
      Object.fromEntries(COLORES.map((c) => [c, despliegueAleatorio(c, azar)])),
      { primero: COLORES[Math.floor(azar() * 4)] }
    );
    let turnos = 0;
    while (!estado.fin && turnos < limite) {
      if (estado.pendiente) {
        const p = estado.pendiente;
        estado = p.tipo === "recoger"
          ? (decisionDeRecogida(estado, p.color) ? recogerLaBandera(estado) : renunciarARecoger(estado))
          : reclutar(estado, Math.max(...p.opciones));
        continue;
      }
      const accion = accionDeBot(estado, estado.turno, { pesos, azar, contador });
      if (!accion) break;
      estado = aplicar(estado, accion);
      turnos++;
      jugadas++;
    }
  }
  return { contador, jugadas };
}

function cargarModelos() {
  const carpeta = path.join(AQUI, "modelos");
  if (!fs.existsSync(carpeta)) return [];
  return fs
    .readdirSync(carpeta)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ nombre: path.basename(f, ".json"), ...JSON.parse(fs.readFileSync(path.join(carpeta, f), "utf8")) }));
}

export function revisar(partidas = 30) {
  const modelos = cargarModelos();
  const { contador, jugadas } = contarActivaciones(PESOS_BASE, partidas);
  // El recuento se hace con la heurística a mano a propósito: mide con qué
  // frecuencia el JUEGO ofrece cada situación, no con qué frecuencia un modelo
  // concreto decide meterse en ella.
  const total = Object.values(contador).reduce((a, b) => a + b, 0) || 1;

  return GENES.map((k) => {
    const valores = modelos.map((m) => (m.pesos ? m.pesos[k] / ESCALAS[k] : null)).filter((v) => v !== null);
    const media = valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : 0;
    const dispersion = valores.length > 1
      ? Math.sqrt(valores.reduce((s, v) => s + (v - media) ** 2, 0) / valores.length)
      : null;
    // `ruido` no se cuenta: se suma a TODAS las acciones candidatas, siempre.
    const siempre = k === "ruido";
    const activaciones = siempre ? Infinity : contador[k] || 0;
    return {
      peso: k,
      activaciones,
      siempre,
      porMilJugadas: siempre ? Infinity : Math.round((activaciones / jugadas) * 1000),
      cuota: activaciones / total,
      aMano: PESOS_BASE[k] / ESCALAS[k],
      entrenados: valores,
      dispersion,
    };
  }).sort((a, b) => a.activaciones - b.activaciones);
}

if (process.argv[1] && process.argv[1].endsWith("revisar-pesos.mjs")) {
  const partidas = Number(process.argv[2]) || 30;
  console.log(`Contando activaciones en ${partidas} partidas...\n`);
  const filas = revisar(partidas);
  const modelos = cargarModelos();
  console.log(`Modelos comparados: ${modelos.map((m) => m.nombre).join(", ") || "ninguno"}\n`);
  console.log(
    "  " + "peso".padEnd(22) + "act/1000".padStart(9) + "a mano".padStart(9) + "entrenado".padStart(11) + "  dispersión  veredicto"
  );
  for (const f of filas) {
    const ent = f.entrenados.length
      ? (f.entrenados.reduce((a, b) => a + b, 0) / f.entrenados.length).toFixed(2)
      : "—";
    const disp = f.dispersion === null ? "—" : f.dispersion.toFixed(2);
    // Poca activación y mucha dispersión entre semillas: el entrenamiento no lo
    // está fijando, lo está dejando caer donde sea.
    const sospechoso = !f.siempre && f.porMilJugadas < 5;
    const inestable = f.dispersion !== null && f.dispersion > 0.8;
    const veredicto = sospechoso && inestable ? "DERIVA" : sospechoso ? "apenas se usa" : inestable ? "inestable" : "";
    console.log(
      "  " + f.peso.padEnd(22) + (f.siempre ? "siempre" : String(f.porMilJugadas)).padStart(9) + f.aMano.toFixed(2).padStart(9) +
        ent.padStart(11) + disp.padStart(12) + "  " + veredicto
    );
  }
  console.log("\n  act/1000 = veces que el término entra en juego por cada mil jugadas.");
  console.log("  dispersión = desviación de ese peso entre los entrenamientos guardados.");
}
