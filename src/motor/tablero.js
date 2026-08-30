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
export const ALCANCE_CANON = 3;

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

// Las casillas desde las que un cañón alcanza el anillo, si la línea está libre.
//
// Son 24 de 146. El dato importa porque explica por qué los cañones casi nunca
// disparan al castillo: no es que el bot desprecie el tiro -cuando puede, lo
// toma el 98% de las veces- es que un cañón mueve UNA casilla por turno y de
// media empieza a 6,6 pasos, así que llegar cuesta siete turnos de caminar en
// línea recta hacia el sitio exacto. Sin un peso que se lo pida, no va nunca.
// Desde dónde bate un cañón la TORRE: las doce casillas que rodean el castillo.
//
// NO es una regla de línea de tiro, es de adyacencia al castillo, y por eso hay
// que tratarla aparte de `rayo`. Se ve claro con G6: está pegada al castillo por
// arriba pero en línea recta hacia el sur solo encuentra G7, G8 y G9, que son
// celdas del anillo — nunca la torre. Aun así bate la torre, porque la bala se
// lanza por encima del anillo.
//
// El cuerpo a cuerpo es otra cosa y ya funciona solo: se ataca la torre desde el
// anillo, y `ADYACENTES[ANILLO]` incluye `TORRE`. Un cañón no puede hacerlo
// porque no combate cuerpo a cuerpo, así que un cañón metido en el anillo no
// tiene forma de atacar la torre.
//
// Aquí el anillo es UNA pseudocasilla; sobre el tablero de verdad son las ocho
// celdas G7 H7 I7 G8 I8 G9 H9 I9, y la torre es H8.
export const BATEN_LA_TORRE = new Set((ADYACENTES[ANILLO] || []).filter((c) => c !== TORRE));

export const BATEN_ANILLO = (() => {
  const salida = new Set();
  for (const casilla of CASILLAS) {
    if (casilla === ANILLO || casilla === TORRE) continue;
    for (const direccion of Object.keys(DIRECCIONES)) {
      if (rayo(casilla, direccion, ALCANCE_CANON).some((p) => p.tipo === "castillo")) {
        salida.add(casilla);
        break;
      }
    }
  }
  return salida;
})();

// Pasos hasta la casilla de tiro más cercana. Hace falta el GRADIENTE, no solo
// el conjunto: un cañón a seis pasos nunca cobraría una bonificación por estar
// en posición, porque ningún movimiento suyo llega de una vez. Con el mapa de
// distancias cada paso que acerca ya puntúa, y por eso el cañón se pone en
// marcha en vez de quedarse donde nació.
export const PASOS_A_TIRO = (() => {
  const mapa = {};
  let frente = [];
  for (const c of BATEN_ANILLO) { mapa[c] = 0; frente.push(c); }
  let d = 0;
  while (frente.length) {
    d++;
    const siguiente = [];
    for (const c of frente) {
      for (const v of ADYACENTES[c] || []) {
        if (mapa[v] === undefined) { mapa[v] = d; siguiente.push(v); }
      }
    }
    frente = siguiente;
  }
  return mapa;
})();

export const PASOS_A_TIRO_MAX = Math.max(1, ...Object.values(PASOS_A_TIRO));


export function casillasDeZona(color) {
  const z = ZONAS[color];
  const lista = [];
  for (let c = z.cols[0]; c <= z.cols[1]; c++) {
    for (let f = z.filas[0]; f <= z.filas[1]; f++) lista.push(nombre(c, f));
  }
  return lista;
}
