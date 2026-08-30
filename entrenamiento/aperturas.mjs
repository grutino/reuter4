// Aperturas: despliegues iniciales con nombre, para medir contra rivales que
// no sean siempre el azar.
//
// Medir solo contra despliegues aleatorios es una vara blanda: gana cualquiera.
// Aquí se juntan cuatro clases de rival, y el banco de pruebas los usa como
// panel en vez de a uno solo:
//
//   · humanas    — escritas a mano por un jugador con miles de partidas
//   · variantes  — las humanas con unas piezas cambiadas de sitio
//   · guiadas    — al azar, pero cumpliendo algunas recomendaciones
//   · campeonas  — las que mejor han puntuado hasta ahora
//
// FORMATO. Una rejilla de 3 filas por 7 columnas en coordenadas de la propia
// zona, así que la misma rejilla vale para los cuatro colores aunque las zonas
// norte y sur sean anchas y las de este y oeste altas:
//
//     fila 1 = la más atrasada, pegada al borde del tablero
//     fila 3 = la más adelantada, la que da a la llanura
//     el punto de la fila 2 es la casilla de reclutamiento y va vacía
//     la bandera la lleva quien ocupe el centro de la fila 1
//
//     9 3 5 7 5 3 8
//     4 6 3 . 3 6 4
//     5 4 7 6 7 4 1

import { ZONAS, coord, nombre as nombreDeCasilla, casillasDeZona } from "../src/motor/tablero.js";
import { inventarioInicial } from "../src/motor/motor.js";

export const FILAS = 3;
export const COLUMNAS = 7;

// Mapa de (fila, columna) de la zona → casilla real, por color.
const REJILLA = (() => {
  const salida = {};
  for (const [color, zona] of Object.entries(ZONAS)) {
    const [cBandera, fBandera] = coord(zona.bandera);
    const anchaEnColumnas = zona.cols[1] - zona.cols[0] > zona.filas[1] - zona.filas[0];
    const casillas = casillasDeZona(color);
    const mapa = {};
    for (const casilla of casillas) {
      const [c, f] = coord(casilla);
      // "fila" es la profundidad: 1 pegado al borde propio, 3 dando a la llanura.
      // "columna" recorre el lado ancho de la zona.
      const profundidad = anchaEnColumnas
        ? (fBandera === zona.filas[0] ? f - zona.filas[0] : zona.filas[1] - f) + 1
        : (cBandera === zona.cols[0] ? c - zona.cols[0] : zona.cols[1] - c) + 1;
      const lateral = (anchaEnColumnas ? c - zona.cols[0] : f - zona.filas[0]) + 1;
      mapa[`${profundidad},${lateral}`] = casilla;
    }
    salida[color] = mapa;
  }
  return salida;
})();

export function casillaDe(color, fila, columna) {
  return REJILLA[color][`${fila},${columna}`];
}

const CENTRO = Math.ceil(COLUMNAS / 2); // 4

// --- Leer una rejilla de texto -------------------------------------------------

export function leerRejilla(texto, etiqueta = "apertura") {
  const filas = texto
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
  if (filas.length !== FILAS) {
    throw new Error(`${etiqueta}: hacen falta ${FILAS} filas de rejilla y hay ${filas.length}`);
  }
  const celdas = filas.map((linea) => linea.split(/\s+/));
  celdas.forEach((fila, i) => {
    if (fila.length !== COLUMNAS) {
      throw new Error(`${etiqueta}: la fila ${i + 1} tiene ${fila.length} casillas y deben ser ${COLUMNAS}`);
    }
  });
  if (celdas[1][CENTRO - 1] !== ".") {
    throw new Error(`${etiqueta}: el centro de la fila 2 es la casilla de reclutamiento y debe ir vacía, con un punto`);
  }

  const rangos = [];
  celdas.forEach((fila, i) => {
    fila.forEach((celda, j) => {
      if (i === 1 && j === CENTRO - 1) return;
      const r = Number(celda);
      if (!Number.isInteger(r) || r < 1 || r > 9) {
        throw new Error(`${etiqueta}: "${celda}" en la fila ${i + 1}, columna ${j + 1} no es un rango de 1 a 9`);
      }
      rangos.push({ fila: i + 1, columna: j + 1, rango: r });
    });
  });

  const esperado = inventarioInicial().slice().sort((a, b) => a - b).join(",");
  const puesto = rangos.map((p) => p.rango).sort((a, b) => a - b).join(",");
  if (esperado !== puesto) {
    const cuenta = (lista) => lista.reduce((m, r) => ((m[r] = (m[r] || 0) + 1), m), {});
    throw new Error(
      `${etiqueta}: el reparto de rangos no cuadra.\n    hay:   ${JSON.stringify(cuenta(rangos.map((p) => p.rango)))}\n    debe:  ${JSON.stringify(cuenta(inventarioInicial()))}`
    );
  }
  return rangos;
}

// Pasa una rejilla al formato que entiende el motor, para un color concreto.
export function aColocacion(rejilla, color) {
  const banderaEn = ZONAS[color].bandera;
  return rejilla.map((p) => {
    const casilla = casillaDe(color, p.fila, p.columna);
    if (!casilla) throw new Error(`no existe la casilla (${p.fila},${p.columna}) en la zona de ${color}`);
    return { casilla, rango: p.rango, bandera: casilla === banderaEn };
  });
}

// --- Variantes ------------------------------------------------------------------
// Intercambia unas cuantas parejas de piezas. Conserva el aire de la apertura
// original y cambia lo justo para que el banco de pruebas no sea siempre igual.

export function variar(rejilla, cambios, azar) {
  const copia = rejilla.map((p) => ({ ...p }));
  for (let i = 0; i < cambios; i++) {
    const a = Math.floor(azar() * copia.length);
    const b = Math.floor(azar() * copia.length);
    if (a === b) continue;
    const t = copia[a].rango;
    copia[a].rango = copia[b].rango;
    copia[b].rango = t;
  }
  return copia;
}

// --- Guiadas ---------------------------------------------------------------------
// Al azar, pero cumpliendo algunas recomendaciones. Cada apertura activa un
// subconjunto distinto, así que la batería es variada y ninguna es la de nadie.

export const RECOMENDACIONES = {
  flancosEquilibrados: (r) => {
    const izq = r.filter((p) => p.columna < CENTRO).reduce((s, p) => s + p.rango, 0);
    const der = r.filter((p) => p.columna > CENTRO).reduce((s, p) => s + p.rango, 0);
    return 1 - Math.abs(izq - der) / (izq + der || 1);
  },
  mediosDelante: (r) => {
    const delante = r.filter((p) => p.fila === FILAS);
    return delante.filter((p) => [4, 5, 7].includes(p.rango)).length / (delante.length || 1);
  },
  exploradoresDetras: (r) => {
    const exp = r.filter((p) => p.rango === 3);
    return exp.filter((p) => p.fila === 1).length / (exp.length || 1);
  },
  altosResguardados: (r) => {
    const altos = r.filter((p) => p.rango >= 8);
    return altos.filter((p) => p.fila < FILAS).length / (altos.length || 1);
  },
  capitanesEnMedio: (r) => {
    const cap = r.filter((p) => p.rango === 6);
    return cap.filter((p) => p.fila === 2).length / (cap.length || 1);
  },
  canonesAlCentro: (r) => {
    const can = r.filter((p) => p.rango === 1);
    return can.filter((p) => Math.abs(p.columna - CENTRO) <= 1).length / (can.length || 1);
  },
  banderaEnPiezaMedia: (r) => {
    const b = r.find((p) => p.fila === 1 && p.columna === CENTRO);
    return b && b.rango >= 4 && b.rango <= 7 ? 1 : 0;
  },
};

export const NOMBRES_RECOMENDACIONES = Object.keys(RECOMENDACIONES);

function rejillaAlAzar(azar) {
  const bolsa = inventarioInicial();
  for (let i = bolsa.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [bolsa[i], bolsa[j]] = [bolsa[j], bolsa[i]];
  }
  const salida = [];
  let k = 0;
  for (let fila = 1; fila <= FILAS; fila++) {
    for (let columna = 1; columna <= COLUMNAS; columna++) {
      if (fila === 2 && columna === CENTRO) continue;
      salida.push({ fila, columna, rango: bolsa[k++] });
    }
  }
  return salida;
}

// Genera una apertura que cumple `cuantas` recomendaciones sacadas al azar. Se
// hace por muestreo: se prueban muchas y se elige la que mejor las satisface.
export function guiada(azar, cuantas = 3, intentos = 300) {
  const elegidas = NOMBRES_RECOMENDACIONES.slice();
  for (let i = elegidas.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [elegidas[i], elegidas[j]] = [elegidas[j], elegidas[i]];
  }
  const activas = elegidas.slice(0, cuantas);
  let mejor = null;
  let mejorNota = -Infinity;
  for (let i = 0; i < intentos; i++) {
    const r = rejillaAlAzar(azar);
    const nota = activas.reduce((s, nombre) => s + RECOMENDACIONES[nombre](r), 0);
    if (nota > mejorNota) {
      mejorNota = nota;
      mejor = r;
    }
    if (mejorNota >= activas.length - 1e-9) break; // ya las cumple todas
  }
  return { rejilla: mejor, recomendaciones: activas, nota: mejorNota / activas.length };
}

// --- Utilidades ---------------------------------------------------------------------

export function aTexto(rejilla) {
  const lineas = [];
  for (let fila = 1; fila <= FILAS; fila++) {
    const celdas = [];
    for (let columna = 1; columna <= COLUMNAS; columna++) {
      if (fila === 2 && columna === CENTRO) {
        celdas.push(".");
        continue;
      }
      const p = rejilla.find((q) => q.fila === fila && q.columna === columna);
      celdas.push(p ? String(p.rango) : "?");
    }
    lineas.push(celdas.join(" "));
  }
  return lineas.join("\n");
}

export function informeDeRecomendaciones(rejilla) {
  return NOMBRES_RECOMENDACIONES.map((n) => ({ nombre: n, cumple: RECOMENDACIONES[n](rejilla) }));
}
