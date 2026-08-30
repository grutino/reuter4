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

import { ZONAS, ADYACENTES, LAGOS, ANILLO, CASILLAS, coord, casillasDeZona, rayo, DIRECCIONES } from "../src/motor/tablero.js";
import { RANGOS, EXPLORADOR, CAPITAN } from "../src/motor/motor.js";
import { DISTANCIA } from "../src/motor/bot.js";

export const RANGOS_ORDENADOS = Object.keys(RANGOS).map(Number).sort((a, b) => b - a); // 9..1
export const PROPIEDADES = [
  "avance",
  "lateral",
  "juntoABandera",
  "juntoAReclutamiento",
  "enElBorde",
  // Añadidos a partir de recomendaciones humanas, pero como MEDIDAS y no como
  // reglas: describen la casilla, no dicen qué rango debe ocuparla.
  "juntoALago",      // el lago cubre un flanco: nadie puede atacar desde ahí
  "cercaDeTiro",     // a qué distancia está de poder batir el anillo con un cañón
  "prontoEnJuego",   // en cuántos turnos entra al medio juego, contando SU paso
];

// Rasgos del despliegue entero, no de una pieza suelta. Sin ellos no se puede
// expresar "reparte la fuerza entre los dos lados", que es una propiedad del
// conjunto y no de ninguna casilla.
export const GLOBALES = ["equilibrioLateral", "rangoDeLaBandera", "fuerzaAdelantada"];

export const TAMANO = RANGOS_ORDENADOS.length * PROPIEDADES.length + GLOBALES.length;

// Casillas desde las que un cañón alcanza el anillo del castillo: hasta tres
// pasos en línea, con la bala sobrevolando lagos. Se calcula sobre el tablero
// vacío, que es lo único que se puede saber antes de empezar.
const CASILLAS_DE_TIRO = (() => {
  const set = new Set();
  for (const casilla of CASILLAS) {
    if (casilla === ANILLO) continue;
    for (const dir of Object.keys(DIRECCIONES)) {
      for (const paso of rayo(casilla, dir, 3)) {
        if (paso.casilla === ANILLO) set.add(casilla);
      }
    }
  }
  return set;
})();

// Saltos hasta la casilla de tiro más cercana, por anchura sobre ADYACENTES.
function distanciaATiroDelAnillo(desde) {
  if (CASILLAS_DE_TIRO.has(desde)) return 0;
  const visto = new Set([desde]);
  let frente = [desde];
  let saltos = 0;
  while (frente.length && saltos < 12) {
    saltos++;
    const siguiente = [];
    for (const c of frente) {
      for (const v of ADYACENTES[c] || []) {
        if (visto.has(v)) continue;
        visto.add(v);
        if (CASILLAS_DE_TIRO.has(v)) return saltos;
        siguiente.push(v);
      }
    }
    frente = siguiente;
  }
  return 12;
}

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
    // Distancia de cada casilla a la más cercana desde la que un cañón batiría
    // el anillo. En la zona de salida ninguna lo consigue, así que lo que se
    // mide es cuánto tardaría en ponerse a tiro.
    const aTiro = {};
    for (const c of casillas) aTiro[c] = distanciaATiroDelAnillo(c);
    const tiros = Object.values(aTiro);
    const tiroMax = Math.max(1, ...tiros);
    const vecinasReclutamiento = new Set(ADYACENTES[zona.reclutamiento] || []);
    let lateralMax = 1;
    for (const casilla of casillas) {
      const [c, f] = coord(casilla);
      lateralMax = Math.max(lateralMax, Math.abs(anchaEnColumnas ? c - cBandera : f - fBandera));
    }
    salida[color] = { anchaEnColumnas, cBandera, fBandera, dMin, dMax, vecinasBandera, vecinasReclutamiento, lateralMax, aTiro, tiroMax };
  }
  return salida;
})();

// Cuántas casillas cubre cada rango por turno. Importa para saber cuándo entra
// realmente en juego una pieza: el explorador cruza el tablero de una sentada y
// el mariscal va paso a paso, así que la misma casilla significa cosas muy
// distintas según quién la ocupe.
function pasosPorTurno(rango) {
  if (rango === EXPLORADOR) return 6; // recorre la recta; 6 es un tope práctico
  if (rango === CAPITAN) return 2;
  return 1;
}

// Propiedades de una pieza en una casilla, todas entre 0 y 1. Casi todas
// dependen solo de la casilla; `prontoEnJuego` depende también del rango.
export function propiedadesDePieza(color, casilla, rango) {
  const g = GEOMETRIA[color];
  const [c, f] = coord(casilla);
  const d = DISTANCIA[casilla];
  const recorridoDeLaZona = g.dMax - g.dMin || 1;
  const lateral = Math.abs(g.anchaEnColumnas ? c - g.cBandera : f - g.fBandera) / g.lateralMax;
  return {
    // 1 = lo más adelantado de la zona, pegado a la llanura.
    avance: d === undefined ? 0 : (g.dMax - d) / recorridoDeLaZona,
    lateral,
    juntoABandera: g.vecinasBandera.has(casilla) ? 1 : 0,
    juntoAReclutamiento: g.vecinasReclutamiento.has(casilla) ? 1 : 0,
    // El borde de la zona: por ahí es por donde se entra y por donde se escapa.
    enElBorde: lateral > 0.99 ? 1 : 0,
    juntoALago: (ADYACENTES[casilla] || []).some((v) => LAGOS.has(v)) ? 1 : 0,
    // 1 = ya está a tiro del anillo; 0 = lo más lejos de estarlo.
    cercaDeTiro: 1 - (g.aTiro[casilla] === undefined ? g.tiroMax : g.aTiro[casilla]) / g.tiroMax,
    // 1 = llega al castillo en seguida; 0 = tarda lo máximo posible. Es lo que
    // separa "está atrás" de "tarda en entrar": un explorador al fondo entra
    // antes que un mariscal adelantado.
    prontoEnJuego: 1 - Math.min(1, (d === undefined ? g.dMax : d) / pasosPorTurno(rango) / g.dMax),
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
    const p = propiedadesDePieza(color, pieza.casilla, pieza.rango);
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

  // --- Rasgos del conjunto ---------------------------------------------------
  const g = GEOMETRIA[color];
  let fuerzaIzquierda = 0;
  let fuerzaDerecha = 0;
  let fuerzaTotal = 0;
  let fuerzaPorAvance = 0;
  let rangoBandera = 0;
  for (const pieza of colocacion) {
    const [c, f] = coord(pieza.casilla);
    const desviacion = (g.anchaEnColumnas ? c - g.cBandera : f - g.fBandera);
    const fuerza = pieza.rango;
    fuerzaTotal += fuerza;
    if (desviacion < 0) fuerzaIzquierda += fuerza;
    else if (desviacion > 0) fuerzaDerecha += fuerza;
    fuerzaPorAvance += fuerza * propiedadesDePieza(color, pieza.casilla, pieza.rango).avance;
    if (pieza.bandera) rangoBandera = pieza.rango;
  }
  const reparto = fuerzaIzquierda + fuerzaDerecha;
  const base = RANGOS_ORDENADOS.length * PROPIEDADES.length;
  // 1 = la fuerza está repartida a partes iguales entre los dos lados;
  // 0 = está toda en uno. Es la recomendación de no cargar un solo flanco,
  // pero puesta como medida: la red decide si le conviene o no.
  vector[base] = reparto ? 1 - Math.abs(fuerzaIzquierda - fuerzaDerecha) / reparto : 1;
  // Qué rango carga con la bandera. Un rango alto la protege pero se queda
  // clavado a un paso por turno; uno bajo es frágil. Es una decisión real y
  // hasta ahora se tomaba al azar.
  vector[base + 1] = rangoBandera / 9;
  vector[base + 2] = fuerzaTotal ? fuerzaPorAvance / fuerzaTotal : 0;
  return vector;
}

export function nombreDeRasgo(indice) {
  const base = RANGOS_ORDENADOS.length * PROPIEDADES.length;
  if (indice >= base) return `conjunto · ${GLOBALES[indice - base]}`;
  const rango = RANGOS_ORDENADOS[Math.floor(indice / PROPIEDADES.length)];
  const propiedad = PROPIEDADES[indice % PROPIEDADES.length];
  return `${rango} ${RANGOS[rango].nombre} · ${propiedad}`;
}

// Inventario completo, para poder revisarlo de un vistazo.
export function inventarioDeRasgos() {
  return Array.from({ length: TAMANO }, (_, i) => ({ indice: i, nombre: nombreDeRasgo(i) }));
}
