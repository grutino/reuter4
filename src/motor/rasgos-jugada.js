// Rasgos de UNA jugada concreta, para que la red pueda compararla con otra.
//
// El intento anterior fracasó por esto: se le daba a la red un resumen de la
// posición resultante, y un resumen no cambia cuando mueves un sargento una
// casilla. Medido en su momento: el 72% de las jugadas candidatas producía un
// vector idéntico a otra. Así no hay nada que elegir.
//
// Aquí la red ve la jugada en sí: qué pieza, a dónde, contra quién, qué gana y
// qué arriesga. Son las mismas magnitudes que calcula la heurística a mano,
// pero en vez de multiplicarlas por veintiséis pesos que compiten entre sí,
// entran como rasgos que comparten gradiente. Eso es lo que arregla el problema
// del evolutivo: un rasgo que aparece poco aprende gracias a los que aparecen
// mucho, en vez de quedarse donde lo dejó la deriva.
//
// La otra mitad de la entrada es el resumen de la posición, que da CONTEXTO: la
// misma jugada no vale igual yendo por delante que por detrás, ni al principio
// que al final. Eso la heurística no podía expresarlo de ninguna forma.

import { ANILLO, TORRE, ADYACENTES, BATEN_ANILLO, PASOS_A_TIRO } from "./tablero.js";
import { resolverDuelo, MARISCAL, ESPIA, CANON, EXPLORADOR, CAPITAN } from "./motor.js";
import { DISTANCIA, bolsaOculta, valorEsperado, amenazasDesde } from "./bot.js";
import { peligroEn } from "./analisis.js";
import { rasgosDePosicion, TAMANO as TAMANO_POSICION, NOMBRES as NOMBRES_POSICION } from "./rasgos-posicion.js";
import { firmaDeRasgos } from "./firma.js";

export const NOMBRES_JUGADA = [
  "esMovimiento",
  "esAtaque",
  "esDisparo",
  "miRango",
  "soyElPortador",
  "seAcerca",
  "seAleja",
  "vaAlCastillo",
  "pisaBanderaSuelta",
  "conGiro",
  "meDelato",
  "objetivoConocido",
  "rangoDelObjetivo",
  "dueloGanado",
  "dueloEmpatado",
  "dueloPerdido",
  "espiaContraMariscal",
  "valorEsperadoDelDuelo",
  "objetivoConBandera",
  // Economía del secreto. Ganar un duelo revela tu rango, así que llevarse un
  // capitán con el mariscal cuesta lo mismo en piezas pero mucho más en
  // información que llevárselo con un comandante. La excepción la aporta el
  // contexto: si esa victoria remata la promoción, quizá compensa.
  //
  // OJO: este orden tiene que coincidir EXACTAMENTE con el de las llamadas a
  // `pon` de abajo. Al insertarlos en distinto sitio quedaron desincronizados y
  // todos los rasgos siguientes salían mal etiquetados, sin dar ningún error.
  "economiaDelAtaque",
  "revelaPiezaAlta",
  "recapturaAlQueMato",
  "amenazasQueDejo",
  "amenazaCombinada",
  "contraAmenaza",
  "peligroConocidoEnDestino",
  "pierdoEnDestino",
  "riesgoDeCanonEnDestino",
  "salgoDePeligro",
  "estorboEnLaTorre",
  // El castillo y los cañones. Faltaba entero: el disparo solo valía por el
  // rango del objetivo, así que batir al que está a un movimiento de coronar
  // puntuaba igual que batirlo en mitad del campo. Y no había ninguna forma de
  // expresar "llevo el cañón a donde sirve" ni "le tapo el tiro al enemigo
  // antes de que suba mi compañero".
  //
  // OJO, otra vez: este orden tiene que coincidir EXACTAMENTE con el de las
  // llamadas a `pon` de abajo.
  "disparoAlCoronador",
  "canonHaciaElTiro",
  "tapaLineaAlAnillo",
];

export const TAMANO = TAMANO_POSICION + NOMBRES_JUGADA.length;
export const NOMBRES = [...NOMBRES_POSICION.map((n) => `posición · ${n}`), ...NOMBRES_JUGADA.map((n) => `jugada · ${n}`)];

// Cambia si cambia cualquier rasgo, aunque el número de entradas siga igual.
export const FIRMA = firmaDeRasgos(NOMBRES);

const recorta = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// `analisis` y `bolsas` se pasan calculados: son por turno, no por jugada, y
// recalcularlos para cada candidata multiplicaría el coste por doce.
export function rasgosDeJugada(estado, color, accion, { analisis, bolsas, resumen, memoria }) {
  const v = new Float64Array(TAMANO);
  v.set(resumen, 0);
  let i = TAMANO_POSICION;
  const pon = (x) => {
    v[i++] = recorta(x);
  };

  const pieza = estado.piezas[accion.pieza];
  const objetivo = accion.hasta ? estado.piezas[estado.tablero[accion.hasta]] : null;
  const conocido = objetivo ? memoria[objetivo.id] : undefined;
  const llevaBandera = Boolean(pieza && pieza.bandera);

  pon(accion.tipo === "mover" ? 1 : 0);
  pon(accion.tipo === "atacar" ? 1 : 0);
  pon(accion.tipo === "disparar" ? 1 : 0);
  pon(pieza ? pieza.rango / 9 : 0);
  pon(llevaBandera ? 1 : 0);

  const antes = DISTANCIA[accion.desde] ?? 30;
  const despues = DISTANCIA[accion.hasta] ?? 30;
  const delta = antes - despues;
  pon(delta > 0 ? Math.min(1, delta / 4) : 0);
  pon(delta < 0 ? Math.min(1, -delta / 4) : 0);
  pon(accion.hasta === ANILLO || accion.hasta === TORRE ? 1 : 0);
  pon(estado.banderasSueltas && estado.banderasSueltas[accion.hasta] ? 1 : 0);
  pon(accion.via ? 1 : 0);
  // Moverse más de una casilla en línea delata al explorador; con giro, al capitán.
  const delata =
    accion.tipo === "mover" &&
    (accion.via || !(ADYACENTES[accion.desde] || []).includes(accion.hasta));
  pon(delata ? 1 : 0);

  pon(conocido !== undefined ? 1 : 0);
  pon(conocido !== undefined ? conocido / 9 : 0);

  let ganado = 0;
  let empatado = 0;
  let perdido = 0;
  if (accion.tipo === "atacar" && pieza) {
    if (conocido !== undefined) {
      const res = resolverDuelo(pieza.rango, conocido);
      ganado = res === "atacante" ? 1 : 0;
      empatado = res === "empate" ? 1 : 0;
      perdido = res === "defensor" ? 1 : 0;
    }
  }
  pon(ganado);
  pon(empatado);
  pon(perdido);
  pon(pieza && pieza.rango === ESPIA && conocido === MARISCAL ? 1 : 0);

  let esperado = 0.5;
  if (accion.tipo === "atacar" && objetivo && conocido === undefined && pieza) {
    if (!bolsas[objetivo.color]) bolsas[objetivo.color] = bolsaOculta(estado, objetivo.color);
    // valorEsperado va de -9 a +9; se lleva a [0,1] con 0,5 = neutro.
    esperado = 0.5 + valorEsperado(pieza.rango, bolsas[objetivo.color]) / 18;
  }
  pon(esperado);
  pon(objetivo && objetivo.bandera ? 1 : 0);

  // Amenazas que la jugada deja planteadas.
  const amenazo = pieza && accion.tipo === "mover"
    ? amenazasDesde(estado, accion.hasta, pieza.rango, color, memoria)
    : objetivo
    ? [objetivo.id]
    : [];
  // Cuánto rango de más estoy enseñando para ganar este duelo. Contra un rango
  // conocido k, la pieza más barata que gana es k+1: todo lo que pase de ahí es
  // secreto malgastado.
  let economia = 0.5;
  let revela = 0;
  let recaptura = 0;
  if (accion.tipo === "atacar" && pieza && conocido !== undefined && ganado) {
    economia = 1 - Math.min(1, Math.max(0, pieza.rango - (conocido + 1)) / 6);
    revela = pieza.rango >= 8 ? 1 : 0;
    // ¿Es este el que acaba de llevarse una de las mías? El hilo lo sabe.
    const ultima = estado.historia && estado.historia[estado.historia.length - 1];
    if (ultima) {
      for (const ev of ultima.eventos || []) {
        if (ev.tipo !== "duelo" || ev.resultado !== "atacante") continue;
        if (ev.atacante.id === objetivo.id && ev.defensor.color === color) recaptura = 1;
      }
    }
  }
  pon(economia);
  pon(revela);
  pon(recaptura);

  pon(Math.min(1, amenazo.length / 3));
  pon(amenazo.some((id) => analisis.presionadasPorSocio.has(id)) ? 1 : 0);
  pon(amenazo.some((id) => analisis.apuntanALosMios.has(id)) ? 1 : 0);

  const riesgo = pieza ? peligroEn(analisis, accion.hasta, pieza.rango) : { peor: 0, pierde: false, riesgoCanon: 0 };
  pon(riesgo.peor / 9);
  pon(riesgo.pierde ? 1 : 0);
  pon(riesgo.riesgoCanon);
  pon(pieza && analisis.enPeligro.mias.has(pieza.id) && !riesgo.pierde ? 1 : 0);
  pon(analisis.socio.aPuntoDeCoronar && (accion.hasta === TORRE || accion.hasta === ANILLO) ? 1 : 0);

  // Batir al que va a coronar. Se gana llegando a la TORRE con la bandera del
  // PROPIO color, así que la ventana es mientras el rival está en el anillo: si
  // ya subió, o ha ganado, o lleva una bandera que no le sirve.
  pon(
    accion.tipo === "disparar" && accion.hasta === ANILLO &&
    analisis.coronadorRival && objetivo && analisis.coronadorRival.id === objetivo.id ? 1 : 0
  );

  // Llevar el cañón a donde sirve. Graduado, no binario: mueve una casilla por
  // turno y de media empieza a 6,6 pasos, así que sin gradiente ningún
  // movimiento suelto expresaría nada y la red no podría aprender a ponerlo en
  // marcha.
  let haciaElTiro = 0;
  if (pieza && pieza.rango === CANON && accion.tipo === "mover") {
    if (BATEN_ANILLO.has(accion.hasta)) haciaElTiro = 1;
    else {
      const antes = PASOS_A_TIRO[accion.desde];
      const despues = PASOS_A_TIRO[accion.hasta];
      if (antes !== undefined && despues !== undefined && despues < antes) haciaElTiro = 0.5;
    }
  }
  pon(haciaElTiro);

  // Taparle el tiro al enemigo antes de que suba el compañero.
  pon(
    accion.tipo === "mover" && analisis.socio.aPuntoDeCoronar &&
    analisis.tapanElAnillo.has(accion.hasta) ? 1 : 0
  );

  return v;
}

// Prepara de una vez lo que comparten todas las jugadas de un mismo turno.
export function contextoDeTurno(estado, color, analisis) {
  return {
    analisis,
    bolsas: {},
    resumen: rasgosDePosicion(estado, color),
    memoria: estado.rangosRevelados || {},
  };
}

export { TAMANO_POSICION };
