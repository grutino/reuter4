// El panel de rivales: contra quién se mide un modelo.
//
// Medir siempre contra despliegues al azar es una vara blanda, y medir siempre
// contra el mismo rival tampoco vale: con no transitividad de por medio, el
// resultado depende de a quién elijas. Así que se mide contra un panel variado
// y se mira tanto el agregado como el desglose, que es donde se ve si un modelo
// gana a todos o solo a los flojos.
//
// El panel se arma con cuatro clases de rival:
//
//   humana     las aperturas de `aperturas/*.txt`, escritas por un jugador
//   variante   esas mismas con unas piezas cambiadas de sitio
//   guiada     al azar pero cumpliendo algunas recomendaciones
//   azar       despliegue completamente aleatorio, como suelo de referencia
//
// Y las campeonas: cualquier apertura que haya batido al panel se guarda en
// `aperturas/campeonas/` y pasa a formar parte de él. La batería se endurece
// sola a medida que aparecen posiciones difíciles.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES } from "../src/motor/tablero.js";
import {
  EQUIPOS, nuevaPartida, aplicar, reclutar, recogerLaBandera, renunciarARecoger, validarDespliegue,
} from "../src/motor/motor.js";
import { accionDeBot, decisionDeRecogida, despliegueAleatorio } from "../src/motor/bot.js";
import { PESOS_VARA } from "../src/motor/pesos-vara.js";
import { generador, repartoDeTablas } from "./arena.mjs";
import { leerRejilla, aColocacion, variar, guiada } from "./aperturas.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const CARPETA = path.join(AQUI, "aperturas");
export const CARPETA_CAMPEONAS = path.join(CARPETA, "campeonas");
const [EQUIPO_A] = EQUIPOS;

// --- Cargar aperturas de disco ---------------------------------------------------

function cargarDe(carpeta, clase) {
  if (!fs.existsSync(carpeta)) return [];
  return fs
    .readdirSync(carpeta)
    .filter((f) => f.endsWith(".txt"))
    .flatMap((f) => {
      const ruta = path.join(carpeta, f);
      try {
        const rejilla = leerRejilla(fs.readFileSync(ruta, "utf8"), f);
        return [{ nombre: path.basename(f, ".txt"), clase, rejilla }];
      } catch (e) {
        console.error(`  ! ${f}: ${e.message}`);
        return [];
      }
    });
}

export function cargarAperturas() {
  return [...cargarDe(CARPETA, "humana"), ...cargarDe(CARPETA_CAMPEONAS, "campeona")];
}

// --- Armar el panel -------------------------------------------------------------

export function construirPanel({ azar, variantesPorHumana = 2, guiadas = 4, conAzar = true } = {}) {
  const base = cargarAperturas();
  const panel = [];

  for (const a of base) {
    panel.push({ nombre: a.nombre, clase: a.clase, rejilla: a.rejilla });
    for (let i = 0; i < variantesPorHumana; i++) {
      panel.push({ nombre: `${a.nombre}~${i + 1}`, clase: "variante", rejilla: variar(a.rejilla, 3 + i, azar) });
    }
  }
  for (let i = 0; i < guiadas; i++) {
    const g = guiada(azar, 2 + (i % 3));
    panel.push({ nombre: `guiada${i + 1}`, clase: "guiada", rejilla: g.rejilla, recomendaciones: g.recomendaciones });
  }
  if (conAzar) panel.push({ nombre: "azar", clase: "azar", rejilla: null });
  return panel;
}

// Un rival del panel produce despliegues; el que no tiene rejilla los saca al azar.
function desplegar(rival, color, azar) {
  return rival.rejilla ? aColocacion(rival.rejilla, color) : despliegueAleatorio(color, azar);
}

// --- Medir --------------------------------------------------------------------------

function jugar(despliegues, jugadaDe, semilla, limite) {
  const azar = generador(semilla ^ 0x5f3759df);
  let estado = nuevaPartida(despliegues, { primero: COLORES[Math.floor(azar() * 4)] });
  let turnos = 0;
  while (!estado.fin && turnos < limite) {
    if (estado.pendiente) {
      const p = estado.pendiente;
      estado = p.tipo === "recoger"
        ? decisionDeRecogida(estado, p.color) ? recogerLaBandera(estado) : renunciarARecoger(estado)
        : reclutar(estado, Math.max(...p.opciones));
      continue;
    }
    const accion = jugadaDe(estado, estado.turno, azar);
    if (!accion) break;
    estado = aplicar(estado, accion);
    turnos++;
  }
  return estado;
}

// `aspirante` describe al bando que se está evaluando: cómo despliega y cómo
// juega. El rival del panel despliega lo suyo y juega con la heurística.
// UN rival del panel. Es la unidad natural de reparto: los rivales no dependen
// unos de otros y lo único que devuelve cada uno es un marcador de tres números,
// así que repartirlos entre hilos no cuesta casi nada en serializar. Eso lo hace
// muy distinto de repartir la tanda de coevolución, que devuelve cien mil
// vectores y donde mover los datos sale más caro que jugar las partidas.
export function medirContraUnRival(aspirante, rival, { parejas = 12, limite = 400, semillaBase = 31337 } = {}) {
  {
    let gana = 0;
    let pierde = 0;
    let tablas = 0;
    for (let i = 0; i < parejas; i++) {
      for (const invertido of [false, true]) {
        const semilla = semillaBase + i * 7919;
        const azar = generador(semilla);
        const despliegues = {};
        for (const color of COLORES) {
          const esAspirante = EQUIPO_A.includes(color) !== invertido;
          despliegues[color] = esAspirante ? aspirante.desplegar(color, azar) : desplegar(rival, color, azar);
        }
        const jugadaDe = (estado, color, az) => {
          const esAspirante = EQUIPO_A.includes(color) !== invertido;
          // El rival del panel juega con los pesos CONGELADOS, no con los
          // actuales: si no, tocar la heurística mueve la vara y los números de
          // antes dejan de ser comparables con los de después. Ha pasado tres
          // veces, y la última costó leer como regresión de 15 puntos lo que era
          // una vara más dura.
          return esAspirante ? aspirante.jugar(estado, color, az) : accionDeBot(estado, color, { azar: az, pesos: PESOS_VARA });
        };
        const estado = jugar(despliegues, jugadaDe, semilla, limite);
        const fin = estado.fin;
        if (!fin || !fin.ganador) tablas++;
        else if (EQUIPO_A.includes(fin.ganador) !== invertido) gana++;
        else pierde++;
      }
    }
    const n = gana + pierde;
    return {
      rival: rival.nombre, clase: rival.clase, gana, pierde, tablas,
      tasa: n ? gana / n : 0.5, error: Math.sqrt(0.25 / Math.max(1, n)),
    };
  }
}

export function medirContraPanel(aspirante, panel, opciones = {}) {
  const porRival = panel.map((rival) => medirContraUnRival(aspirante, rival, opciones));
  return resumirPanel(porRival);
}

// El resumen, aparte: lo usan la versión de un hilo y la repartida, que junta
// los marcadores que le devuelven los obreros.
export function resumirPanel(porRival) {
  const totalG = porRival.reduce((s, r) => s + r.gana, 0);
  const totalP = porRival.reduce((s, r) => s + r.pierde, 0);
  const n = totalG + totalP;
  return {
    porRival,
    gana: totalG,
    pierde: totalP,
    tablas: porRival.reduce((s, r) => s + r.tablas, 0),
    tasa: n ? totalG / n : 0.5,
    error: Math.sqrt(0.25 / Math.max(1, n)),
    // El peor resultado importa tanto como la media: un modelo que gana mucho
    // de media pero pierde siempre contra un rival concreto tiene un agujero.
    peor: porRival.reduce((m, r) => (r.tasa < m.tasa ? r : m), porRival[0]),
  };
}

// Guarda una apertura en el panel de campeonas, para que endurezca la batería.
export function guardarCampeona(rejilla, nombre, nota) {
  fs.mkdirSync(CARPETA_CAMPEONAS, { recursive: true });
  const destino = path.join(CARPETA_CAMPEONAS, `${nombre}.txt`);
  const lineas = [`# campeona · ${nota}`, `# generada el ${new Date().toISOString().slice(0, 10)}`];
  fs.writeFileSync(destino, `${lineas.join("\n")}\n${rejillaATexto(rejilla)}\n`);
  return destino;
}

function rejillaATexto(rejilla) {
  const filas = [];
  for (let fila = 1; fila <= 3; fila++) {
    const celdas = [];
    for (let columna = 1; columna <= 7; columna++) {
      if (fila === 2 && columna === 4) { celdas.push("."); continue; }
      const p = rejilla.find((q) => q.fila === fila && q.columna === columna);
      celdas.push(p ? String(p.rango) : "?");
    }
    filas.push(celdas.join(" "));
  }
  return filas.join("\n");
}

export { validarDespliegue };
