// Análisis del tablero para los bots: quién amenaza a quién, y en qué anda el
// compañero.
//
// Se calcula UNA VEZ por turno y luego cada jugada candidata solo consulta.
// Hacerlo por jugada multiplicaría el coste por cien, que es más o menos el
// número de acciones legales que hay en una posición normal.
//
// Todo lo de aquí es información pública: posiciones, y rangos solo si ya se
// han visto en un combate. Nunca se mira `estado.piezas[id].rango` de una pieza
// ajena, que es la regla que separa a un bot de un tramposo.

import { ADYACENTES, ANILLO, TORRE, DIRECCIONES, rayo, ALCANCE_CANON } from "./tablero.js";
import { movimientosLegales, resolverDuelo, banderaQueCorona, SOCIO, RANGOS, CANON, EXPLORADOR, CAPITAN } from "./motor.js";

const esEnemigo = (color, otro) => otro !== color && SOCIO[color] !== otro;

// Casillas que una pieza podría batir en su próximo turno. Con el rango a la
// vista se sabe exactamente; sin él se supone cuerpo a cuerpo, que es lo que
// puede hacer cualquiera, y aparte se marca el disparo de cañón como posible.
function casillasBatidas(estado, pieza, rangoConocido) {
  const salida = [];
  const desde = pieza.casilla;

  if (rangoConocido === CANON) {
    for (const dir of Object.keys(DIRECCIONES)) {
      for (const paso of rayo(desde, dir, 3)) {
        if (paso.tipo === "lago") continue; // la bala sobrevuela el lago
        salida.push(paso.casilla);
        if (estado.tablero[paso.casilla] || paso.tipo === "castillo") break;
      }
    }
    return salida;
  }

  if (rangoConocido === EXPLORADOR) {
    for (const dir of Object.keys(DIRECCIONES)) {
      for (const paso of rayo(desde, dir)) {
        if (paso.tipo === "lago") break; // el explorador no cruza lagos
        salida.push(paso.casilla);
        if (estado.tablero[paso.casilla] || paso.tipo === "castillo") break;
      }
    }
    return salida;
  }

  for (const vecina of ADYACENTES[desde] || []) salida.push(vecina);

  if (rangoConocido === CAPITAN) {
    for (const intermedia of ADYACENTES[desde] || []) {
      if (estado.tablero[intermedia]) continue;
      for (const destino of ADYACENTES[intermedia] || []) {
        if (destino !== desde) salida.push(destino);
      }
    }
  }
  return salida;
}

// Línea de cañón desde una casilla: por dónde podría dispararle un cañón que
// aún no se ha visto. Se usa para el miedo a lo que no se conoce.
function lineaDeCanon(estado, desde) {
  const salida = [];
  for (const dir of Object.keys(DIRECCIONES)) {
    for (const paso of rayo(desde, dir, 3)) {
      if (paso.tipo === "lago") continue;
      salida.push(paso.casilla);
      if (estado.tablero[paso.casilla] || paso.tipo === "castillo") break;
    }
  }
  return salida;
}

// Probabilidad de que una pieza sin identificar de este color sea un cañón.
// Tratar "puede haber un cañón en esa línea" como certeza sale carísimo: solo
// hay dos cañones entre veinte piezas, y el bot que se lo cree no avanza nunca.
function riesgoDeCanon(estado, color, memoria) {
  let ocultas = 0;
  let canonesVistos = 0;
  for (const p of Object.values(estado.piezas)) {
    if (p.color !== color) continue;
    const visto = memoria[p.id];
    if (visto === undefined) ocultas++;
    else if (visto === CANON) canonesVistos++;
  }
  if (!ocultas) return 0;
  const quedan = Math.max(0, RANGOS[CANON].cantidad - canonesVistos);
  return Math.min(1, quedan / ocultas);
}

function distanciaATorre(mapa, casilla) {
  const d = mapa[casilla];
  return d === undefined ? 40 : d;
}

// `distancias` es el mapa de saltos al castillo, que el bot ya tiene calculado.
// `misAcciones` se recibe ya calculada: el bot la necesita igualmente para
// puntuar, y generarla dos veces era la mitad del coste del análisis.
export function analizarTurno(estado, color, distancias, misAcciones = null) {
  const socio = SOCIO[color];
  const memoria = estado.rangosRevelados || {};

  // --- Peligro por casilla ---------------------------------------------------
  // Para cada casilla, lo peor que le puede caer encima desde el bando rival.
  const peligro = {};
  const anotar = (casilla, campo, valor, quien) => {
    if (!peligro[casilla]) peligro[casilla] = { peorConocido: 0, hayDesconocido: false, riesgoCanon: 0, quienes: [] };
    if (campo === "peorConocido") peligro[casilla].peorConocido = Math.max(peligro[casilla].peorConocido, valor);
    else if (campo === "riesgoCanon") peligro[casilla].riesgoCanon = Math.max(peligro[casilla].riesgoCanon, valor);
    else peligro[casilla][campo] = true;
    if (quien && !peligro[casilla].quienes.includes(quien)) peligro[casilla].quienes.push(quien);
  };

  const riesgoPorColor = {};

  for (const pieza of Object.values(estado.piezas)) {
    if (!esEnemigo(color, pieza.color)) continue;
    const conocido = memoria[pieza.id];
    for (const casilla of casillasBatidas(estado, pieza, conocido)) {
      if (conocido !== undefined) anotar(casilla, "peorConocido", conocido, pieza.id);
      else anotar(casilla, "hayDesconocido", true, pieza.id);
    }
    // Un enemigo sin identificar PODRÍA ser un cañón, con la probabilidad que
    // salga de lo que aún le queda escondido a su color.
    if (conocido === undefined) {
      if (riesgoPorColor[pieza.color] === undefined) riesgoPorColor[pieza.color] = riesgoDeCanon(estado, pieza.color, memoria);
      const riesgo = riesgoPorColor[pieza.color];
      if (riesgo > 0) {
        for (const casilla of lineaDeCanon(estado, pieza.casilla)) anotar(casilla, "riesgoCanon", riesgo, pieza.id);
      }
    }
  }

  // --- Quién amenaza a quién -------------------------------------------------
  // Ojo con lo que se puede mirar. De MIS piezas conozco el rango; de las del
  // compañero NO: en este juego ni el socio ve tus rangos. Así que la amenaza
  // propia se calcula exacta y la del compañero solo por posición, que es
  // información pública. Hay una prueba que vigila justo esto.
  const amenazadasPorMi = new Set();
  for (const a of misAcciones || movimientosLegales(estado, color)) {
    if (a.tipo !== "atacar" && a.tipo !== "disparar") continue;
    const id = estado.tablero[a.hasta];
    if (!id) continue;
    const objetivo = estado.piezas[id];
    if (!objetivo || !esEnemigo(color, objetivo.color)) continue;
    if (a.tipo === "disparar") {
      amenazadasPorMi.add(id); // el cañón se lleva por delante a cualquiera
      continue;
    }
    const suyo = memoria[objetivo.id];
    if (suyo !== undefined && resolverDuelo(estado.piezas[a.pieza].rango, suyo) === "atacante") {
      amenazadasPorMi.add(id);
    }
  }

  // Presión del compañero: enemigos que tienen encima una pieza suya. No se
  // sabe si ganaría el duelo —su rango está tapado— pero estar al lado ya
  // obliga al rival a contar con ello, y eso basta para el ataque combinado.
  const presionadasPorSocio = new Set();
  for (const pieza of Object.values(estado.piezas)) {
    if (pieza.color !== socio) continue;
    for (const casilla of casillasBatidas(estado, pieza, memoria[pieza.id])) {
      const id = estado.tablero[casilla];
      if (!id) continue;
      const otra = estado.piezas[id];
      if (otra && esEnemigo(color, otra.color)) presionadasPorSocio.add(id);
    }
  }

  // --- Piezas de mi bando en peligro ----------------------------------------
  const enPeligro = { mias: new Set(), socio: new Set() };
  // Quién está apuntando a los míos: es lo que permite la contraamenaza, que es
  // amenazar al que amenaza para que tenga que elegir.
  const apuntanALosMios = new Set();
  for (const pieza of Object.values(estado.piezas)) {
    if (pieza.color !== color && pieza.color !== socio) continue;
    const p = peligro[pieza.casilla];
    if (!p) continue;
    // De las mías sé el rango y puedo decir si pierden. De las del compañero
    // solo sé que tienen enemigos encima: eso es presión, no certeza.
    const rangoVisible = pieza.color === color ? pieza.rango : memoria[pieza.id];
    // "En peligro" es solo la amenaza CIERTA: un rango visto que gana el duelo.
    // El riesgo de cañón es una probabilidad y se pondera aparte; meterlo aquí
    // ponía a casi todas las piezas en peligro y el bot se pasaba el rato
    // huyendo en vez de jugar.
    const batida =
      rangoVisible !== undefined
        ? Boolean(p.peorConocido) && resolverDuelo(p.peorConocido, rangoVisible) === "atacante"
        : p.peorConocido > 0;
    if (!batida) continue;
    (pieza.color === color ? enPeligro.mias : enPeligro.socio).add(pieza.id);
    for (const id of p.quienes) apuntanALosMios.add(id);
  }

  // --- Cómo va el compañero --------------------------------------------------
  // Si el compañero puede coronar pronto, lo que toca es despejarle el camino y
  // no estorbar en la torre, no correr uno mismo hacia el castillo.
  const banderaSocio = estado.banderas[socio];
  let socioLlevaBandera = false;
  let socioDistancia = 40;
  if (banderaSocio && banderaSocio.portador && estado.piezas[banderaSocio.portador]) {
    const portador = estado.piezas[banderaSocio.portador];
    // Cuenta si lo lleva alguien del equipo, sea el dueño o yo mismo.
    socioLlevaBandera = portador.color === socio;
    if (socioLlevaBandera) socioDistancia = distanciaATorre(distancias, portador.casilla);
  }
  const torreOcupada = Boolean(estado.tablero[TORRE]);

  // --- El castillo: quién está a punto de ganar y quién puede impedirlo ------
  //
  // Se gana llegando a la TORRE con una bandera aliada, así que el rival
  // realmente urgente es el que está en el ANILLO llevando bandera: le queda un
  // movimiento. Sin esto, un bot le disparaba con la misma gana que a cualquier
  // otra pieza, porque el disparo solo valía por el rango.
  //
  // La torre sí se bate, pero solo desde el anillo o desde las cuatro casillas
  // alineadas con ella a dos pasos (`BATEN_LA_TORRE`); `rayo` no la devuelve
  // nunca, así que el motor la trata aparte. Aun así el rival urgente sigue
  // siendo el del anillo: quien ya está en la torre con SU bandera ha ganado, y
  // quien está con la de otro color no gana nada, solo ocupa el sitio.
  const enElAnillo = estado.tablero[ANILLO] ? estado.piezas[estado.tablero[ANILLO]] : null;
  const coronadorRival =
    enElAnillo && esEnemigo(color, enElAnillo.color) && banderaQueCorona(estado, enElAnillo) ? enElAnillo : null;

  // Líneas por las que un cañón enemigo puede batir el anillo. Cada una trae las
  // casillas intermedias: plantarse en cualquiera de ellas corta el disparo, que
  // es lo que hay que hacer antes de que suba el compañero.
  //
  // Se cuenta también al enemigo sin identificar, con el riesgo que salga de su
  // bolsa oculta, por la misma razón que el resto del análisis: esperar a estar
  // seguro de que es un cañón es esperar a que dispare.
  const lineasAlAnillo = [];
  for (const pieza of Object.values(estado.piezas)) {
    if (!esEnemigo(color, pieza.color)) continue;
    const conocido = memoria[pieza.id];
    if (conocido !== undefined && conocido !== CANON) continue;
    let riesgo = 1;
    if (conocido === undefined) {
      if (riesgoPorColor[pieza.color] === undefined) riesgoPorColor[pieza.color] = riesgoDeCanon(estado, pieza.color, memoria);
      riesgo = riesgoPorColor[pieza.color];
      if (riesgo <= 0) continue;
    }
    for (const direccion of Object.keys(DIRECCIONES)) {
      const pasos = rayo(pieza.casilla, direccion, ALCANCE_CANON);
      const intermedias = [];
      let llega = false;
      for (const paso of pasos) {
        if (paso.tipo === "lago") continue; // la bala sobrevuela el lago
        if (paso.tipo === "castillo") { llega = true; break; }
        if (estado.tablero[paso.casilla]) break; // ya hay algo tapando
        intermedias.push(paso.casilla);
      }
      if (llega) lineasAlAnillo.push({ desde: pieza.casilla, de: pieza.id, riesgo, intermedias });
    }
  }
  const tapanElAnillo = new Set();
  for (const linea of lineasAlAnillo) for (const c of linea.intermedias) tapanElAnillo.add(c);

  return {
    coronadorRival,
    lineasAlAnillo,
    // Casillas donde plantarse corta al menos una línea de tiro al anillo.
    tapanElAnillo,
    peligro,
    amenazadasPorMi,
    presionadasPorSocio,
    enPeligro,
    apuntanALosMios,
    socio: {
      llevaBandera: socioLlevaBandera,
      distancia: socioDistancia,
      // "A punto" es que le queden dos saltos o menos: ahí es cuando estorbar
      // en el anillo o la torre le cuesta la partida al equipo.
      aPuntoDeCoronar: socioLlevaBandera && socioDistancia <= 2,
    },
    torreOcupada,
  };
}

// Lo que el enemigo podría batir si me planto en `casilla` llevando `rango`.
export function peligroEn(analisis, casilla, rango) {
  const p = analisis.peligro[casilla];
  if (!p) return { pierde: false, peor: 0, riesgoCanon: 0, hayDesconocido: false };
  return {
    pierde: Boolean(p.peorConocido) && resolverDuelo(p.peorConocido, rango) === "atacante",
    peor: p.peorConocido,
    riesgoCanon: p.riesgoCanon,
    hayDesconocido: p.hayDesconocido,
  };
}

export { esEnemigo };
