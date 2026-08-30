// Qué ha aprendido el modelo. No cuánto gana: qué ha aprendido.
//
// Un modelo que gana y no se puede leer sirve para jugar y para nada más. Aquí
// se abre en canal de dos formas, una por cada cosa que se ha entrenado:
//
//   · La RED DE DESPLIEGUE se sondea por sensibilidad: cuánto sube o baja la
//     probabilidad de ganar al mover cada propiedad de cada rango, promediado
//     sobre despliegues reales. Es la derivada, medida a base de empujar la
//     entrada, y dice qué prefiere la red sin tener que creerse sus pesos.
//
//   · Los PESOS DE LA HEURÍSTICA se leen directamente, pero solo los que se
//     activan bastante: un peso que casi nunca entra en juego tiene el valor
//     que le dejó la deriva, no el que aprendió. Esa distinción la da
//     `revisar-pesos.mjs` y aquí se respeta.
//
//   node entrenamiento/interpretar.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES } from "../src/motor/tablero.js";
import { RANGOS } from "../src/motor/motor.js";
import { despliegueAleatorio, PESOS_BASE } from "../src/motor/bot.js";
import { generador } from "./arena.mjs";
import { rasgosDeDespliegue, RANGOS_ORDENADOS, PROPIEDADES, GLOBALES } from "./rasgos-despliegue.mjs";
import { desdeObjeto, evaluar } from "./red.mjs";
import { ESCALAS, GENES } from "./genoma.mjs";
import { revisar } from "./revisar-pesos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MODELOS = path.join(AQUI, "modelos");

// --- La red de despliegue -----------------------------------------------------

export function sensibilidadDeLaRed(red, muestras = 400, paso = 0.15) {
  const azar = generador(97);
  const base = [];
  for (let i = 0; i < muestras; i++) {
    const color = COLORES[i % 4];
    base.push(rasgosDeDespliegue(color, despliegueAleatorio(color, azar)));
  }
  const efecto = new Float64Array(base[0].length);
  for (const vector of base) {
    for (let k = 0; k < vector.length; k++) {
      const original = vector[k];
      vector[k] = Math.min(1, original + paso);
      const arriba = evaluar(red, vector);
      vector[k] = Math.max(0, original - paso);
      const abajo = evaluar(red, vector);
      vector[k] = original;
      efecto[k] += arriba - abajo;
    }
  }
  const corte = RANGOS_ORDENADOS.length * PROPIEDADES.length;
  return Array.from(efecto, (v, k) => ({
    indice: k,
    esGlobal: k >= corte,
    rango: k >= corte ? null : RANGOS_ORDENADOS[Math.floor(k / PROPIEDADES.length)],
    propiedad: k >= corte ? GLOBALES[k - corte] : PROPIEDADES[k % PROPIEDADES.length],
    efecto: v / base.length,
  }));
}

const COMO_SE_LEE = {
  prontoEnJuego: ["que entre pronto en juego", "que tarde en entrar"],
  juntoALago: ["cubierta por un lago", "lejos de los lagos"],
  cercaDeTiro: ["cerca de poder batir el anillo", "lejos del anillo"],
  equilibrioLateral: ["la fuerza repartida entre los dos flancos", "la fuerza cargada en un flanco"],
  rangoDeLaBandera: ["la bandera sobre una pieza alta", "la bandera sobre una pieza baja"],
  fuerzaAdelantada: ["la fuerza adelantada", "la fuerza atrás"],
  avance: ["más adelantado", "más al fondo"],
  lateral: ["más abierto a los lados", "más al centro"],
  juntoABandera: ["pegado a la bandera", "lejos de la bandera"],
  juntoAReclutamiento: ["junto al reclutamiento", "lejos del reclutamiento"],
  enElBorde: ["en el borde de la zona", "por dentro de la zona"],
};

function contarDespliegue(filas, limite = 12) {
  const ordenadas = filas.slice().sort((a, b) => Math.abs(b.efecto) - Math.abs(a.efecto)).slice(0, limite);
  console.log("\n  Lo que la red prefiere, de más rotundo a menos:\n");
  for (const f of ordenadas) {
    const [siSube, siBaja] = COMO_SE_LEE[f.propiedad] || [f.propiedad + " alto", f.propiedad + " bajo"];
    const quiere = f.efecto > 0 ? siSube : siBaja;
    const fuerza = Math.abs(f.efecto);
    const barra = "#".repeat(Math.max(1, Math.round(fuerza * 300)));
    const quien = f.esGlobal ? "  conjunto   " : `    ${f.rango} ${RANGOS[f.rango].nombre.padEnd(11)}`;
    console.log(`${quien} ${quiere.padEnd(42)} ${(fuerza * 100).toFixed(2).padStart(5)}  ${barra}`);
  }
}

// --- Los pesos de la heurística ------------------------------------------------

function contarPesos(partidas) {
  const modelos = fs
    .readdirSync(MODELOS)
    .filter((f) => f.startsWith("pesos-") && !f.includes("sin6"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(MODELOS, f), "utf8")));
  if (!modelos.length) {
    console.log("\n  No hay modelos de pesos guardados.");
    return;
  }
  const activaciones = Object.fromEntries(revisar(partidas).map((f) => [f.peso, f]));

  const filas = GENES.map((k) => {
    const valores = modelos.map((m) => m.pesos && m.pesos[k]).filter((v) => v !== undefined).map((v) => v / ESCALAS[k]);
    if (!valores.length) return null;
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    const desv = Math.sqrt(valores.reduce((s, v) => s + (v - media) ** 2, 0) / valores.length);
    const act = activaciones[k];
    return {
      peso: k,
      media,
      desv,
      aMano: PESOS_BASE[k] / ESCALAS[k],
      porMil: act ? act.porMilJugadas : 0,
      siempre: act ? act.siempre : false,
    };
  }).filter(Boolean);

  // Solo se interpreta lo que se activa y es estable entre semillas. El resto
  // es deriva y decir algo sobre ello sería inventar.
  const fiables = filas.filter((f) => (f.siempre || f.porMil >= 90) && f.desv < 1.2);
  const dudosos = filas.filter((f) => !fiables.includes(f));

  console.log(`\n  Con ${modelos.length} entrenamientos, y solo los pesos que se activan y son estables:\n`);
  for (const f of fiables.sort((a, b) => Math.abs(b.media) - Math.abs(a.media))) {
    const signo = f.media >= 0 ? "+" : "";
    const contraste =
      Math.sign(f.media) !== Math.sign(f.aMano) && Math.abs(f.aMano) > 0.05 ? "  <- signo contrario al escrito a mano" : "";
    console.log(
      `    ${f.peso.padEnd(22)} ${(signo + f.media.toFixed(2)).padStart(7)}   a mano ${f.aMano.toFixed(2).padStart(6)}   ±${f.desv.toFixed(2)}${contraste}`
    );
  }
  console.log(`\n  Sin interpretar por deriva o por inestables: ${dudosos.map((d) => d.peso).join(", ")}`);
}

if (process.argv[1] && process.argv[1].endsWith("interpretar.mjs")) {
  const partidas = Number(process.argv[2]) || 20;
  console.log("QUÉ HA APRENDIDO EL MODELO");
  console.log("\n=== 1. La posición de salida ===");
  const ficheroRed = path.join(MODELOS, "red-despliegue.json");
  if (fs.existsSync(ficheroRed)) {
    const guardado = JSON.parse(fs.readFileSync(ficheroRed, "utf8"));
    console.log(`  pérdida de validación ${guardado.perdidaValidacion.toFixed(4)} · victorias en juego ${(guardado.victoriasEnJuego * 100).toFixed(0)}%`);
    contarDespliegue(sensibilidadDeLaRed(desdeObjeto(guardado.red)));
  } else {
    console.log("  Todavía no hay red de despliegue entrenada.");
  }
  console.log("\n\n=== 2. Cómo jugar: los pesos de la heurística ===");
  contarPesos(partidas);
}
