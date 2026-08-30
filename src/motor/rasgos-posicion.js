// Rasgos de una posición en mitad de partida, vista desde un color.
//
// Es la entrada de la red de valoración: dado un tablero, ¿qué probabilidad
// tiene este bando de ganar? Con eso se puede puntuar cualquier jugada mirando
// la posición que deja, que es lo que resuelve el problema que hundió al
// evolutivo: allí cada peso competía por su cuenta y solo cuatro de veintiséis
// llegaron a fijarse. Aquí todos los rasgos comparten el mismo gradiente, así
// que uno que aparece poco aprende gracias a los que aparecen mucho.
//
// LA REGLA QUE NO SE PUEDE ROMPER: solo información pública y la propia. De mis
// piezas conozco el rango; de las del compañero y de las enemigas, únicamente
// lo que se haya destapado en combate. Hay una prueba que lo vigila.

import { ANILLO, TORRE, COLORES } from "./tablero.js";
import { RANGOS, SOCIO, EQUIPOS, inventarioInicial } from "./motor.js";
import { DISTANCIA } from "./bot.js";
import { analizarTurno } from "./analisis.js";

const FUERZA_TOTAL = inventarioInicial().reduce((a, b) => a + b, 0); // 20 piezas
const PIEZAS = 20;
const DISTANCIA_MAX = 30;

export const NOMBRES = [
  // --- Material y supervivencia ---------------------------------------------
  "misPiezas",
  "miFuerza",
  "piezasDelSocio",
  "piezasEnemigas",
  "ventajaDePiezas",
  "misBajas",
  // --- Carrera por el castillo ----------------------------------------------
  "miBanderaAlCastillo",
  "banderaDelSocioAlCastillo",
  "banderaEnemigaAlCastillo",
  "llevoMiBandera",
  "elSocioLlevaBandera",
  "algunEnemigoLlevaBandera",
  "hayBanderaEnElSuelo",
  "ocupoElAnillo",
  "ocupoLaTorre",
  "elEnemigoOcupaElCastillo",
  "miPiezaMasCerca",
  "suPiezaMasCerca",
  "misPiezasEnElCastillo",
  "susPiezasEnElCastillo",
  // --- Reclutamiento ---------------------------------------------------------
  "miMarcador",
  "marcadorDelSocio",
  "marcadorEnemigo",
  // --- Información -----------------------------------------------------------
  "rangosQueLesHeVisto",
  "rangosQueMeHanVisto",
  "miMariscalVivo",
  "miEspiaVivo",
  "misCanonesVivos",
  "misExploradoresVivos",
  // --- Amenazas --------------------------------------------------------------
  "miasEnPeligro",
  "delSocioEnPeligro",
  "queAmenazo",
  "amenazasCombinadas",
  // --- Fase ------------------------------------------------------------------
  "avanceDeLaPartida",
];

export const TAMANO = NOMBRES.length;

const recorta = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const cerca = (d) => (d === undefined ? 0 : recorta(1 - d / DISTANCIA_MAX));

function distanciaDeBandera(estado, color) {
  const bandera = estado.banderas[color];
  if (!bandera) return undefined;
  if (bandera.portador && estado.piezas[bandera.portador]) return DISTANCIA[estado.piezas[bandera.portador].casilla];
  if (bandera.casilla) return DISTANCIA[bandera.casilla];
  return undefined;
}

export function rasgosDePosicion(estado, color) {
  const socio = SOCIO[color];
  const equipo = EQUIPOS.find((e) => e.includes(color));
  const enemigos = COLORES.filter((c) => !equipo.includes(c));
  const memoria = estado.rangosRevelados || {};
  const v = new Float64Array(TAMANO);
  let i = 0;
  const pon = (x) => {
    v[i++] = recorta(x);
  };

  // --- Material --------------------------------------------------------------
  let mias = 0;
  let miFuerza = 0;
  let delSocio = 0;
  let deEllos = 0;
  let masCercaMia = Infinity;
  let masCercaSuya = Infinity;
  let miasEnCastillo = 0;
  let suyasEnCastillo = 0;
  let vistosDeEllos = 0;
  let vistosMios = 0;
  let mariscal = 0;
  let espia = 0;
  let canones = 0;
  let exploradores = 0;

  for (const p of Object.values(estado.piezas)) {
    const d = DISTANCIA[p.casilla];
    const enCastillo = p.casilla === ANILLO || p.casilla === TORRE;
    if (p.color === color) {
      mias++;
      miFuerza += p.rango; // rango propio: se puede mirar
      if (d !== undefined && d < masCercaMia) masCercaMia = d;
      if (enCastillo) miasEnCastillo++;
      if (memoria[p.id] !== undefined) vistosMios++;
      if (p.rango === 9) mariscal = 1;
      if (p.rango === 2) espia = 1;
      if (p.rango === 1) canones++;
      if (p.rango === 3) exploradores++;
    } else if (p.color === socio) {
      delSocio++;
      if (d !== undefined && d < masCercaMia) masCercaMia = d;
      if (enCastillo) miasEnCastillo++;
    } else {
      deEllos++;
      if (d !== undefined && d < masCercaSuya) masCercaSuya = d;
      if (enCastillo) suyasEnCastillo++;
      if (memoria[p.id] !== undefined) vistosDeEllos++;
    }
  }

  pon(mias / PIEZAS);
  pon(miFuerza / FUERZA_TOTAL);
  pon(delSocio / PIEZAS);
  pon(deEllos / (PIEZAS * 2));
  pon(0.5 + (mias + delSocio - deEllos) / (PIEZAS * 4)); // 0,5 = igualdad
  pon((estado.bajas[color] || []).length / PIEZAS);

  // --- Carrera por el castillo ------------------------------------------------
  const dMia = distanciaDeBandera(estado, color);
  const dSocio = distanciaDeBandera(estado, socio);
  const dEnemiga = Math.min(...enemigos.map((c) => distanciaDeBandera(estado, c) ?? DISTANCIA_MAX));
  pon(cerca(dMia));
  pon(cerca(dSocio));
  pon(cerca(dEnemiga));

  const portadorDe = (c) => {
    const b = estado.banderas[c];
    return b && b.portador && estado.piezas[b.portador] ? estado.piezas[b.portador] : null;
  };
  const miPortador = portadorDe(color);
  const suPortador = portadorDe(socio);
  pon(miPortador && miPortador.color === color ? 1 : 0);
  pon(suPortador && suPortador.color === socio ? 1 : 0);
  pon(enemigos.some((c) => portadorDe(c)) ? 1 : 0);
  pon(Object.keys(estado.banderasSueltas || {}).length ? 1 : 0);

  const enAnillo = estado.tablero[ANILLO] ? estado.piezas[estado.tablero[ANILLO]] : null;
  const enTorre = estado.tablero[TORRE] ? estado.piezas[estado.tablero[TORRE]] : null;
  pon(enAnillo && equipo.includes(enAnillo.color) ? 1 : 0);
  pon(enTorre && equipo.includes(enTorre.color) ? 1 : 0);
  pon((enAnillo && !equipo.includes(enAnillo.color)) || (enTorre && !equipo.includes(enTorre.color)) ? 1 : 0);
  pon(cerca(masCercaMia === Infinity ? undefined : masCercaMia));
  pon(cerca(masCercaSuya === Infinity ? undefined : masCercaSuya));
  pon(miasEnCastillo / 2);
  pon(suyasEnCastillo / 2);

  // --- Reclutamiento -----------------------------------------------------------
  pon((estado.marcador[color] || 0) / 6);
  pon((estado.marcador[socio] || 0) / 6);
  pon(Math.max(...enemigos.map((c) => estado.marcador[c] || 0)) / 6);

  // --- Información --------------------------------------------------------------
  pon(deEllos ? vistosDeEllos / deEllos : 0);
  pon(mias ? vistosMios / mias : 0);
  pon(mariscal);
  pon(espia);
  pon(canones / RANGOS[1].cantidad);
  pon(exploradores / RANGOS[3].cantidad);

  // --- Amenazas ------------------------------------------------------------------
  const analisis = analizarTurno(estado, color, DISTANCIA);
  pon(analisis.enPeligro.mias.size / PIEZAS);
  pon(analisis.enPeligro.socio.size / PIEZAS);
  pon(analisis.amenazadasPorMi.size / PIEZAS);
  let combinadas = 0;
  for (const id of analisis.amenazadasPorMi) if (analisis.presionadasPorSocio.has(id)) combinadas++;
  pon(combinadas / 4);

  // --- Fase ------------------------------------------------------------------------
  const jugadas = estado.historia && estado.historia.length ? estado.historia[estado.historia.length - 1].n : 0;
  pon(jugadas / 200);

  return v;
}

export function nombreDeRasgo(indice) {
  return NOMBRES[indice] || `rasgo ${indice}`;
}
