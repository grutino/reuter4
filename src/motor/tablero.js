// Geometría del tablero de Reuter4 (cara de 4 jugadores).
// Rejilla nominal 15x15, columnas A-O, filas 1-15. Solo 165 casillas están en juego.

export const COLUMNAS = "ABCDEFGHIJKLMNO";
export const ANILLO = "ANILLO";
export const TORRE = "TORRE";

export const COLORES = ["rojo", "verde", "azul", "amarillo"]; // orden horario: N, E, S, O

export const ZONAS = {
  rojo: { lado: "norte", cols: [4, 10], filas: [1, 3], reclutamiento: "H2", bandera: "H1" },
  verde: { lado: "este", cols: [12, 14], filas: [5, 11], reclutamiento: "N8", bandera: "O8" },
  azul: { lado: "sur", cols: [4, 10], filas: [13, 15], reclutamiento: "H14", bandera: "H15" },
  amarillo: { lado: "oeste", cols: [0, 2], filas: [5, 11], reclutamiento: "B8", bandera: "A8" },
};

export const LAGOS = new Set([
  "G5", "H5", "I5",
  "G11", "H11", "I11",
  "E7", "E8", "E9",
  "K7", "K8", "K9",
]);

// Huella física del castillo: 3x3. Lógicamente son dos posiciones, ANILLO y TORRE.
export const CASTILLO_HUELLA = new Set([
  "G7", "H7", "I7",
  "G8", "H8", "I8",
  "G9", "H9", "I9",
]);

export const DIRECCIONES = { N: [0, -1], S: [0, 1], E: [1, 0], O: [-1, 0] };

// Desde el ANILLO, cada dirección arranca en la casilla de acceso central de ese lado.
const EJES_ANILLO = { N: "H6", S: "H10", E: "J8", O: "F8" };

export function coord(casilla) {
  return [COLUMNAS.indexOf(casilla[0]), parseInt(casilla.slice(1), 10)];
}

export function nombre(c, f) {
  if (c < 0 || c > 14 || f < 1 || f > 15) return null;
  return COLUMNAS[c] + f;
}

function enRango(v, [min, max]) {
  return v >= min && v <= max;
}

export function zonaDe(casilla) {
  const [c, f] = coord(casilla);
  for (const [color, z] of Object.entries(ZONAS)) {
    if (enRango(c, z.cols) && enRango(f, z.filas)) return color;
  }
  return null;
}

function enLlanura(casilla) {
  const [c, f] = coord(casilla);
  return c >= 3 && c <= 11 && f >= 4 && f <= 12;
}

// Una casilla "existe" si es zona de salida o llanura. El bosque no existe.
export function existe(casilla) {
  if (!casilla) return false;
  return Boolean(zonaDe(casilla)) || enLlanura(casilla);
}

// Transitable: existe, no es lago y no está bajo la huella del castillo.
export function transitable(casilla) {
  return existe(casilla) && !LAGOS.has(casilla) && !CASTILLO_HUELLA.has(casilla);
}

export const CASILLAS = (() => {
  const lista = [];
  for (let c = 0; c < 15; c++) {
    for (let f = 1; f <= 15; f++) {
      const n = nombre(c, f);
      if (transitable(n)) lista.push(n);
    }
  }
  lista.push(ANILLO, TORRE);
  return lista;
})();

export const ACCESOS_CASTILLO = (() => {
  const set = new Set();
  for (const casilla of CASILLAS) {
    if (casilla === ANILLO || casilla === TORRE) continue;
    const [c, f] = coord(casilla);
    for (const [dc, df] of Object.values(DIRECCIONES)) {
      const vecina = nombre(c + dc, f + df);
      if (vecina && CASTILLO_HUELLA.has(vecina)) set.add(casilla);
    }
  }
  return set;
})();

export const ADYACENTES = (() => {
  const mapa = {};
  for (const casilla of CASILLAS) mapa[casilla] = [];
  for (const casilla of CASILLAS) {
    if (casilla === ANILLO || casilla === TORRE) continue;
    const [c, f] = coord(casilla);
    for (const [dc, df] of Object.values(DIRECCIONES)) {
      const vecina = nombre(c + dc, f + df);
      if (!vecina) continue;
      if (CASTILLO_HUELLA.has(vecina)) {
        if (!mapa[casilla].includes(ANILLO)) mapa[casilla].push(ANILLO);
      } else if (transitable(vecina)) {
        mapa[casilla].push(vecina);
      }
    }
  }
  mapa[ANILLO] = [...ACCESOS_CASTILLO, TORRE];
  mapa[TORRE] = [ANILLO];
  return mapa;
})();

// Un rayo devuelve los pasos en una dirección. Cada paso es un salto de distancia 1.
// tipo: "casilla" (ocupable), "lago" (se sobrevuela, nunca hay piezas), "castillo" (= ANILLO, y corta).
export function rayo(desde, direccion, pasosMax = Infinity) {
  const pasos = [];
  let c;
  let f;
  if (desde === TORRE) return pasos;
  if (desde === ANILLO) {
    const eje = EJES_ANILLO[direccion];
    [c, f] = coord(eje);
    pasos.push({ tipo: "casilla", casilla: eje });
    if (pasos.length >= pasosMax) return pasos;
  } else {
    [c, f] = coord(desde);
  }
  const [dc, df] = DIRECCIONES[direccion];
  while (pasos.length < pasosMax) {
    c += dc;
    f += df;
    const siguiente = nombre(c, f);
    if (!siguiente) break;
    if (CASTILLO_HUELLA.has(siguiente)) {
      pasos.push({ tipo: "castillo", casilla: ANILLO });
      break; // no se atraviesa el castillo
    }
    if (!existe(siguiente)) break; // bosque o fuera del tablero
    if (LAGOS.has(siguiente)) {
      pasos.push({ tipo: "lago", casilla: siguiente });
      continue;
    }
    pasos.push({ tipo: "casilla", casilla: siguiente });
  }
  return pasos;
}

export function casillasDeZona(color) {
  const z = ZONAS[color];
  const lista = [];
  for (let c = z.cols[0]; c <= z.cols[1]; c++) {
    for (let f = z.filas[0]; f <= z.filas[1]; f++) lista.push(nombre(c, f));
  }
  return lista;
}
