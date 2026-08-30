// Rasgos de un despliegue inicial, para que la red pueda juzgarlo.
//
// La posición de salida es hoy el mayor agujero del bot: `despliegueAleatorio`
// reparte las veinte piezas al azar. En un juego donde el rival no ve tus
// rangos, dónde escondes el espía, dónde plantas los cañones y qué cubre a la
// bandera pesa tanto como jugar bien después.
//
// Nada de esto lleva conocimiento humano metido a mano. Los rasgos solo
// describen la geometría —cuánto avanza una pieza, cuánto se abre a los lados,
// si tapa la bandera—; qué combinación es buena lo tiene que sacar la red de
// los resultados de miles de partidas. Si al final resulta que los cañones
// quieren ir detrás de los lagos, será porque ha ganado más veces, no porque
// se lo hayamos dicho.
//
// Los rasgos son invariantes a la orientación: las zonas norte y sur son
// anchas y las de este y oeste son altas, así que todo se mide en «avance
// hacia el castillo» y «apertura lateral» en vez de en filas y columnas. Así
// los cuatro colores alimentan el mismo conjunto de entrenamiento.

import { ZONAS, ADYACENTES, coord, casillasDeZona } from "../src/motor/tablero.js";
import { RANGOS } from "../src/motor/motor.js";
import { DISTANCIA } from "../src/motor/bot.js";

export const RANGOS_ORDENADOS = Object.keys(RANGOS).map(Number).sort((a, b) => b - a); // 9..1
export const PROPIEDADES = ["avance", "lateral", "juntoABandera", "juntoAReclutamiento", "enElBorde"];
export const TAMANO = RANGOS_ORDENADOS.length * PROPIEDADES.length;

// Geometría de cada zona, calculada una vez.
const GEOMETRIA = (() => {
  const salida = {};
  for (const [color, zona] of Object.entries(ZONAS)) {
    const casillas = casillasDeZona(color);
    const [cBandera, fBandera] = coord(zona.bandera);
    const anchaEnColumnas = zona.cols[1] - zona.cols[0] > zona.filas[1] - zona.filas[0];
    const distancias = casillas.map((c) => DISTANCIA[c]).filter((d) => d !== undefined);
    const dMin = Math.min(...distancias);
    const dMax = Math.max(...distancias);
    const vecinasBandera = new Set(ADYACENTES[zona.bandera] || []);
    const vecinasReclutamiento = new Set(ADYACENTES[zona.reclutamiento] || []);
    let lateralMax = 1;
    for (const casilla of casillas) {
      const [c, f] = coord(casilla);
      lateralMax = Math.max(lateralMax, Math.abs(anchaEnColumnas ? c - cBandera : f - fBandera));
    }
    salida[color] = { anchaEnColumnas, cBandera, fBandera, dMin, dMax, vecinasBandera, vecinasReclutamiento, lateralMax };
  }
  return salida;
})();

// Las cinco propiedades de una casilla, todas entre 0 y 1.
export function propiedadesDeCasilla(color, casilla) {
  const g = GEOMETRIA[color];
  const [c, f] = coord(casilla);
  const d = DISTANCIA[casilla];
  const rango = g.dMax - g.dMin || 1;
  const lateral = Math.abs(g.anchaEnColumnas ? c - g.cBandera : f - g.fBandera) / g.lateralMax;
  return {
    // 1 = lo más adelantado de la zona, pegado a la llanura.
    avance: d === undefined ? 0 : (g.dMax - d) / rango,
    lateral,
    juntoABandera: g.vecinasBandera.has(casilla) ? 1 : 0,
    juntoAReclutamiento: g.vecinasReclutamiento.has(casilla) ? 1 : 0,
    // El borde de la zona: por ahí es por donde se entra y por donde se escapa.
    enElBorde: lateral > 0.99 ? 1 : 0,
  };
}

// Vector de entrada de la red: por cada rango, la media de cada propiedad
// entre las piezas de ese rango. Una pieza suelta y tres repartidas dan
// vectores distintos, que es justo lo que interesa distinguir.
export function rasgosDeDespliegue(color, colocacion) {
  const vector = new Float64Array(TAMANO);
  const sumas = {};
  const cuentas = {};
  for (const r of RANGOS_ORDENADOS) {
    sumas[r] = PROPIEDADES.map(() => 0);
    cuentas[r] = 0;
  }
  for (const pieza of colocacion) {
    const p = propiedadesDeCasilla(color, pieza.casilla);
    const r = pieza.rango;
    if (!sumas[r]) continue;
    PROPIEDADES.forEach((nombre, i) => {
      sumas[r][i] += p[nombre];
    });
    cuentas[r] += 1;
  }
  RANGOS_ORDENADOS.forEach((r, iRango) => {
    const n = cuentas[r] || 1;
    PROPIEDADES.forEach((_, iProp) => {
      vector[iRango * PROPIEDADES.length + iProp] = sumas[r][iProp] / n;
    });
  });
  return vector;
}

export function nombreDeRasgo(indice) {
  const rango = RANGOS_ORDENADOS[Math.floor(indice / PROPIEDADES.length)];
  const propiedad = PROPIEDADES[indice % PROPIEDADES.length];
  return `${rango} ${RANGOS[rango].nombre} · ${propiedad}`;
}
