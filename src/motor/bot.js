// Bots de Reuter4. Módulo compartido: lo usan el servidor y la simulación,
// para que lo que se mide sea exactamente lo que se juega.
//
// Regla de oro: un bot solo puede mirar información pública. Corre dentro del
// servidor, con el estado completo a mano, así que la tentación de leer
// `estado.piezas[id].rango` de una pieza enemiga está a un carácter de distancia.
// No se hace. La única fuente sobre rangos ajenos es `estado.rangosRevelados`,
// que el motor alimenta con lo que ha quedado a la vista de toda la mesa.

import { ANILLO, TORRE, ADYACENTES, ZONAS, casillasDeZona, BATEN_ANILLO, PASOS_A_TIRO, DIRECCIONES, rayo, ALCANCE_CANON } from "./tablero.js";
import { analizarTurno, peligroEn } from "./analisis.js";
import {
  RANGOS,
  MARISCAL,
  ESPIA,
  movimientosLegales,
  inventarioInicial,
  resolverDuelo,
  CANON,
  SOCIO,
} from "./motor.js";

// Distancia en saltos de cada casilla al castillo. El objetivo del juego está
// ahí, así que casi toda la orientación posicional sale de este mapa.
export const DISTANCIA = (() => {
  const d = { [ANILLO]: 0, [TORRE]: 0 };
  let frente = [ANILLO];
  while (frente.length) {
    const siguiente = [];
    for (const c of frente) {
      for (const v of ADYACENTES[c]) {
        if (d[v] === undefined) {
          d[v] = d[c] + 1;
          siguiente.push(v);
        }
      }
    }
    frente = siguiente;
  }
  return d;
})();

// `azar` se puede sustituir por un generador con semilla. El entrenamiento lo
// necesita: comparar dos configuraciones con los mismos despliegues y los mismos
// desempates quita casi todo el ruido, y bajan mucho las partidas necesarias.
export function barajar(lista, azar = Math.random) {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

export function despliegueAleatorio(color, azar = Math.random) {
  const zona = casillasDeZona(color).filter((c) => c !== ZONAS[color].reclutamiento);
  const casillaBandera = ZONAS[color].bandera;
  const resto = barajar(zona.filter((c) => c !== casillaBandera), azar);
  const usadas = [casillaBandera, ...resto.slice(0, 19)];
  const bolsa = barajar(inventarioInicial(), azar);
  return usadas.map((casilla, i) => ({ casilla, rango: bolsa[i], bandera: casilla === casillaBandera }));
}

// --- Bot clásico -------------------------------------------------------------
// El de siempre: posicional, sin memoria. Se conserva intacto como vara de medir
// en `npm run simular`. No lo toques para "mejorarlo": deja de ser referencia.

export function accionDeBotClasico(estado, color, { azar = Math.random } = {}) {
  const acciones = movimientosLegales(estado, color);
  if (!acciones.length) return null;
  let mejor = null;
  let mejorNota = -Infinity;
  for (const a of acciones) {
    const pieza = estado.piezas[a.pieza];
    const propia = pieza.bandera && (pieza.bandera === color || SOCIO[color] === pieza.bandera);
    let nota = azar() * 2;
    if (a.tipo === "mover") {
      const antes = DISTANCIA[a.desde] ?? 30;
      const despues = DISTANCIA[a.hasta] ?? 30;
      if (a.hasta === TORRE && propia) nota += 10000;
      else if (propia) nota += (antes - despues) * 14 + 6;
      else nota += (antes - despues) * 3;
      if (estado.banderasSueltas[a.hasta]) nota += 25;
    }
    if (a.tipo === "disparar") nota += 55;
    if (a.tipo === "atacar") {
      nota += 12 + pieza.rango * 2.5;
      if (propia) nota -= 60;
      if (pieza.rango <= 2) nota -= 15;
      if (a.hasta === ANILLO || a.hasta === TORRE) nota += 20;
    }
    if (nota > mejorNota) {
      mejorNota = nota;
      mejor = a;
    }
  }
  return mejor;
}

// --- Memoria de lo visto -----------------------------------------------------

function esEnemigo(color, otro) {
  return otro !== color && SOCIO[color] !== otro;
}

// Qué rangos podría tener todavía escondidos un color: el inventario completo
// menos los que ya se le han visto sobre el tablero. Es un prior, no un recuento
// exacto: no descuenta bajas, porque las bajas ajenas no son información pública.
export function bolsaOculta(estado, color) {
  const restantes = {};
  for (const [rango, info] of Object.entries(RANGOS)) restantes[rango] = info.cantidad;
  for (const p of Object.values(estado.piezas)) {
    if (p.color !== color) continue;
    const visto = estado.rangosRevelados ? estado.rangosRevelados[p.id] : undefined;
    if (visto !== undefined) restantes[visto] = Math.max(0, restantes[visto] - 1);
  }
  return restantes;
}

// Valor de un duelo en "puntos de rango": ganar vale lo que te llevas por
// delante, perder cuesta lo que dejas atrás, y el empate cuesta un cuarto
// porque te cambia pieza por pieza.
function valorDuelo(miRango, suRango) {
  const res = resolverDuelo(miRango, suRango);
  if (res === "atacante") return suRango;
  if (res === "empate") return -miRango * 0.25;
  return -miRango;
}

// Contra un desconocido no hay certeza, pero sí una media: se pondera el valor
// del duelo por lo que aún puede quedarle escondido al rival.
export function valorEsperado(miRango, restantes) {
  let total = 0;
  let puntos = 0;
  for (const [rango, cuantas] of Object.entries(restantes)) {
    if (!cuantas) continue;
    total += cuantas;
    puntos += cuantas * valorDuelo(miRango, Number(rango));
  }
  return total ? puntos / total : 0;
}

// Peor cosa que me puede pasar si me planto en esta casilla: el rango conocido
// más alto entre los enemigos que la tocan y que me ganarían. Solo mira rangos
// revelados, así que el bot teme a lo que ha visto, no a lo que hay.
export function amenazaConocida(estado, casilla, miRango, color) {
  const memoria = estado.rangosRevelados || {};
  let peor = 0;
  for (const vecina of ADYACENTES[casilla] || []) {
    const id = estado.tablero[vecina];
    if (!id) continue;
    const otra = estado.piezas[id];
    if (!otra || !esEnemigo(color, otra.color)) continue;
    const conocido = memoria[otra.id];
    if (conocido === undefined) continue;
    if (resolverDuelo(conocido, miRango) === "atacante") peor = Math.max(peor, conocido);
  }
  return peor;
}

// --- Pesos de la heurística ---------------------------------------------------
// Sacados a una tabla con nombre para poder entrenarlos fuera del juego. Estos
// son los valores puestos a mano, que sirven de punto de partida y de rival de
// referencia: un entrenamiento que no los gane no ha aprendido nada.

export const PESOS_BASE = {
  ruido: 2,                    // desempate aleatorio, evita que el bot se atasque

  // Movimiento
  coronar: 10000,              // llevar la bandera propia a la torre gana la partida
  avanceConBandera: 14,        // acercar la bandera al castillo
  primaPortador: 6,            // el portador se mueve, no se queda mirando
  avanceNormal: 3,             // el resto también empuja hacia el castillo
  banderaSuelta: 25,           // pisar una bandera del suelo
  amenazaBase: 3,              // plantarse al lado de quien sabemos que nos gana
  amenazaFactor: 1,            // ...y cuánto pesa el rango de esa amenaza

  // Cañonazo
  disparoConocidoBase: 20,
  disparoConocidoFactor: 7,
  disparoDesconocido: 45,
  disparoABandera: 40,
  // El disparo valía solo por el rango, así que batir al que está en el anillo
  // -a un movimiento de coronar- puntuaba igual que batirlo en mitad del campo.
  // Medido: cuando el tiro al anillo es legal el bot ya lo toma el 98% de las
  // veces, pero solo lo es en el 1% de los turnos en que hay un rival ahí.
  disparoAlCastillo: 45,       // el objetivo está en el castillo, anillo o torre
  disparoAlCoronador: 400,     // y además puede coronar en su turno: es la partida
  disparoCercaDelCentro: 14,   // factor por cercanía al castillo, aunque no lleve bandera
  // Llevar el cañón a donde sirve. Sin esto no va nunca: mueve una casilla por
  // turno y de media empieza a 6,6 pasos del castillo, así que ningún movimiento
  // suelto le acerca lo bastante para cobrar nada.
  //
  // PERO ESTOS PESOS SON DIMINUTOS A PROPÓSITO, y costó descubrirlo. La primera
  // versión les puso 24/20/5 y el bot pasó a PERDER 37% contra el de antes. No
  // era que los cañones murieran -mueren en duelo el 1% de las veces, igual que
  // antes- sino TEMPO: cada turno que un cañón camina es un turno que nadie usa
  // para avanzar banderas o pelear, y en una carrera a cuatro eso se paga. Un
  // "ve a posición de tiro" incondicional es una orden mala.
  //
  // Medido contra el bot anterior en tres juegos de semillas, escalando los tres
  // pesos a la vez:
  //
  //   x1,00 -> 36%     x0,25 -> 51%     x0,12 -> 59%     x0,06 -> 62%     apagado -> 52%
  //
  // O sea que el empujón PEQUEÑO sí gana: el cañón se coloca cuando no tiene
  // nada mejor que hacer, en vez de abandonar todo lo demás. Y no se pueden
  // poner a cero: la red solo ordena las candidatas que le pasa la heurística,
  // así que con peso cero la jugada no asoma nunca y la red no puede aprender
  // cuándo conviene. Con estos valores asoma entre las cuatro mejores en un 40%
  // de las ocasiones en que existe, que es sitio de sobra para aprenderla.
  canonEnPosicionDeTiro: 2.5,  // se planta en una de las 24 casillas que baten el anillo
  canonConLineaLibre: 2,       // y además la línea está despejada
  canonSeAcercaATiro: 0.5,     // factor por cada paso que se acerca a una de ellas
  // Y cuando hay algo que batir, el cañón sí corre. Con los pesos de arriba, en
  // 17.213 turnos medidos un cañón estuvo en una de las doce casillas que baten
  // la torre solo 2 veces, y nunca con la torre ocupada: el tiro a la torre no
  // llegó a ser legal ni una vez, aunque la torre está ocupada el 12,8% de los
  // turnos. Subir el peso general no vale -eso es lo que costó la partida por
  // tempo-, así que el empujón se condiciona a que haya blanco.
  canonHaciaBlancoEnTorre: 9,  // factor por paso, solo con un enemigo en la torre
  // Tapar el tiro rival antes de que suba el que lleva la bandera, sea el
  // compañero o uno mismo. Es la tarea defensiva que faltaba entera: solo
  // existía "no me metas TÚ en una línea de tiro".
  taparCanonAlAnillo: 40,

  // Ataque cuerpo a cuerpo
  ataqueGanaBase: 30,          // captura segura contra un rango ya visto
  ataqueGanaFactor: 6,
  ataqueEmpate: -12,           // intercambio parejo, rara vez interesa
  ataquePierde: -120,          // suicidio a sabiendas
  espiaAMariscal: 90,          // el espía existe para esto
  ataqueDesconocido: 4,        // factor del valor esperado contra un desconocido
  ataqueABandera: 60,          // quien lleva bandera es objetivo prioritario
  portadorNoPelea: -60,
  ataqueAlCastillo: 20,

  // --- Amenazas, en pareja ----------------------------------------------------
  // Cada concepto va dos veces: lo que gano al provocarlo y lo que pierdo al
  // sufrirlo. Sin la mitad defensiva el bot juega a ciegas hacia delante.
  amenazaGenerada: 22,         // acabo la jugada amenazando a alguien a quien gano
  amenazaCombinada: 70,        // ...y mi compañero ya le apuntaba: solo salva a uno
  contraAmenaza: 45,           // amenazo al que está apuntando a los míos
  exponerseACanon: -18,        // me meto en la línea de tiro de un cañón posible
  salvarAmenazada: 40,         // saco de la línea a una pieza que estaba en peligro
  estorbarEnTorre: -120,       // el compañero va a coronar y yo le tapo el sitio
};

// A quién amenazaría esta pieza si acabase su jugada en `casilla`. Solo cuenta
// cuerpo a cuerpo con rango ya visto: una amenaza que no se sabe ganada no es
// una amenaza, es una apuesta.
// ¿Desde aquí llega la bala al castillo sin que nadie la pare?
function lineaLibreAlCastillo(estado, casilla) {
  for (const direccion of Object.keys(DIRECCIONES)) {
    for (const paso of rayo(casilla, direccion, ALCANCE_CANON)) {
      if (paso.tipo === "lago") continue; // la bala sobrevuela el lago
      if (paso.tipo === "castillo") return true;
      if (estado.tablero[paso.casilla]) break;
    }
  }
  return false;
}

export function amenazasDesde(estado, casilla, miRango, color, memoria) {
  const sobre = [];
  for (const vecina of ADYACENTES[casilla] || []) {
    const id = estado.tablero[vecina];
    if (!id) continue;
    const otra = estado.piezas[id];
    if (!otra || !esEnemigo(color, otra.color)) continue;
    const suyo = memoria[otra.id];
    if (suyo !== undefined && resolverDuelo(miRango, suyo) === "atacante") sobre.push(otra.id);
  }
  return sobre;
}

// --- Bot con memoria ---------------------------------------------------------

// `contador` es opcional y solo lo usa la revisión de pesos: apunta cuántas
// veces entra en juego cada término. Un peso que casi nunca se activa no lo
// sujeta la selección, y deriva; sin este recuento no hay forma de saberlo.
// Devuelve TODAS las acciones legales con su nota. `accionDeBot` se queda con
// la mejor; el bot con red lo usa para quedarse con las mejores y volver a
// juzgarlas, que sale mucho más barato que valorar las cien con la red.
export function puntuarAcciones(estado, color, opciones = {}) {
  return accionDeBot(estado, color, { ...opciones, devolverTodas: true }) || [];
}

export function accionDeBot(estado, color, { pesos = PESOS_BASE, azar = Math.random, contador = null, devolverTodas = false } = {}) {
  const apuntar = contador ? (k) => { contador[k] = (contador[k] || 0) + 1; } : () => {};
  const acciones = movimientosLegales(estado, color);
  if (!acciones.length) return null;

  const memoria = estado.rangosRevelados || {};
  const bolsas = {}; // prior de cada rival, calculado una vez por turno
  // El análisis del tablero se hace una vez y lo consultan todas las jugadas.
  const analisis = analizarTurno(estado, color, DISTANCIA, acciones);

  let mejor = null;
  let mejorNota = -Infinity;
  const puntuadas = devolverTodas ? [] : null;

  for (const a of acciones) {
    const pieza = estado.piezas[a.pieza];
    const llevaBanderaAmiga = pieza.bandera && (pieza.bandera === color || SOCIO[color] === pieza.bandera);
    let nota = azar() * pesos.ruido;

    if (a.tipo === "mover") {
      const antes = DISTANCIA[a.desde] ?? 30;
      const despues = DISTANCIA[a.hasta] ?? 30;
      if (a.hasta === TORRE && llevaBanderaAmiga) { nota += pesos.coronar; apuntar("coronar"); }
      else if (llevaBanderaAmiga) { nota += (antes - despues) * pesos.avanceConBandera + pesos.primaPortador; apuntar("avanceConBandera"); apuntar("primaPortador"); }
      else { nota += (antes - despues) * pesos.avanceNormal; apuntar("avanceNormal"); }
      if (estado.banderasSueltas[a.hasta]) { nota += pesos.banderaSuelta; apuntar("banderaSuelta"); }

      // Novedad: no meter la cabeza al lado de alguien que ya sabemos que nos gana.
      // Al portador de bandera le duele el doble, porque su caída suelta la bandera.
      const amenaza = amenazaConocida(estado, a.hasta, pieza.rango, color);
      if (amenaza && !llevaBanderaAmiga) { nota -= pesos.amenazaBase + amenaza * pesos.amenazaFactor; apuntar("amenazaBase"); apuntar("amenazaFactor"); }

      // Defenderse: la línea de tiro de un cañón que aún no se ha visto.
      const riesgo = peligroEn(analisis, a.hasta, pieza.rango);
      if (riesgo.riesgoCanon > 0) { nota += pesos.exponerseACanon * riesgo.riesgoCanon; apuntar("exponerseACanon"); }

      // Sacar de la línea a una pieza que ya estaba señalada.
      if (analisis.enPeligro.mias.has(pieza.id) && !riesgo.pierde) {
        nota += pesos.salvarAmenazada;
        apuntar("salvarAmenazada");
      }

      // No taparle la torre al compañero cuando va a coronar en su turno.
      if (analisis.socio.aPuntoDeCoronar && (a.hasta === TORRE || a.hasta === ANILLO)) {
        nota += pesos.estorbarEnTorre;
        apuntar("estorbarEnTorre");
      }

      // Poner el cañón donde sirve de algo.
      if (pieza.rango === CANON) {
        if (BATEN_ANILLO.has(a.hasta)) {
          nota += pesos.canonEnPosicionDeTiro;
          apuntar("canonEnPosicionDeTiro");
          if (lineaLibreAlCastillo(estado, a.hasta)) {
            nota += pesos.canonConLineaLibre;
            apuntar("canonConLineaLibre");
          }
        }
        const antes = PASOS_A_TIRO[a.desde];
        const despues = PASOS_A_TIRO[a.hasta];
        if (antes !== undefined && despues !== undefined && despues < antes) {
          nota += pesos.canonSeAcercaATiro * (antes - despues);
          apuntar("canonSeAcercaATiro");
          // Con un enemigo instalado en la torre el viaje sí tiene premio, y
          // además hay prisa: mientras siga ahí, nadie del equipo puede coronar.
          if (analisis.blancoEnLaTorre) {
            nota += pesos.canonHaciaBlancoEnTorre * (antes - despues);
            apuntar("canonHaciaBlancoEnTorre");
          }
        }
      }

      // Taparle el tiro al enemigo cuando el compañero va a subir. Es lo caro de
      // una coronación: subes al anillo y te barre un cañón que llevaba tres
      // turnos apuntando.
      // Vale cualquier pieza que llegue con su movimiento -un explorador cruza
      // el tablero de una sentada, un capitán da el rodeo-, menos un cañón: no
      // combate cuerpo a cuerpo, así que plantarlo ahí es regalarlo.
      if (analisis.equipoAPuntoDeCoronar && analisis.tapanElAnillo.has(a.hasta) && pieza.rango !== CANON) {
        nota += pesos.taparCanonAlAnillo;
        apuntar("taparCanonAlAnillo");
      }

      // Amenazas que dejo planteadas al terminar la jugada.
      const amenazo = amenazasDesde(estado, a.hasta, pieza.rango, color, memoria);
      if (amenazo.length) {
        nota += pesos.amenazaGenerada;
        apuntar("amenazaGenerada");
        // La combinada es la buena: si mi compañero ya le apuntaba, en su turno
        // el rival solo puede salvar a uno de los dos.
        if (amenazo.some((id) => analisis.presionadasPorSocio.has(id))) {
          nota += pesos.amenazaCombinada;
          apuntar("amenazaCombinada");
        }
        // Y amenazar al que amenaza: le obligo a mirar atrás.
        if (amenazo.some((id) => analisis.apuntanALosMios.has(id))) {
          nota += pesos.contraAmenaza;
          apuntar("contraAmenaza");
        }
      }
    }

    if (a.tipo === "disparar") {
      // El cañón se retira al disparar, así que el disparo vale lo que se lleva
      // por delante. Contra un rango conocido se puede afinar; si no, media.
      const objetivo = estado.piezas[estado.tablero[a.hasta]];
      const conocido = objetivo ? memoria[objetivo.id] : undefined;
      if (conocido !== undefined) { nota += pesos.disparoConocidoBase + conocido * pesos.disparoConocidoFactor; apuntar("disparoConocidoBase"); apuntar("disparoConocidoFactor"); }
      else { nota += pesos.disparoDesconocido; apuntar("disparoDesconocido"); }
      if (objetivo && objetivo.bandera) { nota += pesos.disparoABandera; apuntar("disparoABandera"); }

      // Dónde está el que recibe el cañonazo, que es la mitad que faltaba.
      if (a.hasta === ANILLO || a.hasta === TORRE) {
        nota += pesos.disparoAlCastillo;
        apuntar("disparoAlCastillo");
        if (analisis.coronadorRival && objetivo && analisis.coronadorRival.id === objetivo.id) {
          nota += pesos.disparoAlCoronador;
          apuntar("disparoAlCoronador");
        }
      } else {
        // Y aunque no lleve bandera: una pieza fuerte maniobrando cerca del
        // centro es justo la que conviene quitar antes de que empiece el baile
        // de las banderas.
        const d = DISTANCIA[a.hasta];
        if (d !== undefined) {
          const cerca = Math.max(0, 1 - d / 8);
          if (cerca > 0) { nota += pesos.disparoCercaDelCentro * cerca; apuntar("disparoCercaDelCentro"); }
        }
      }
    }

    if (a.tipo === "atacar") {
      const objetivo = estado.piezas[estado.tablero[a.hasta]];
      const conocido = objetivo ? memoria[objetivo.id] : undefined;

      if (conocido !== undefined) {
        const res = resolverDuelo(pieza.rango, conocido);
        if (res === "atacante") { nota += pesos.ataqueGanaBase + conocido * pesos.ataqueGanaFactor; apuntar("ataqueGanaBase"); apuntar("ataqueGanaFactor"); }
        else if (res === "empate") { nota += pesos.ataqueEmpate; apuntar("ataqueEmpate"); }
        else { nota += pesos.ataquePierde; apuntar("ataquePierde"); }
        // El espía existe para esto y para nada más.
        if (pieza.rango === ESPIA && conocido === MARISCAL) { nota += pesos.espiaAMariscal; apuntar("espiaAMariscal"); }
      } else {
        if (!bolsas[objetivo.color]) bolsas[objetivo.color] = bolsaOculta(estado, objetivo.color);
        nota += valorEsperado(pieza.rango, bolsas[objetivo.color]) * pesos.ataqueDesconocido;
        apuntar("ataqueDesconocido");
      }

      // Quien lleva una bandera es objetivo prioritario, sea de quien sea:
      // si es enemiga se captura, y si es nuestra se recupera.
      if (objetivo && objetivo.bandera) { nota += pesos.ataqueABandera; apuntar("ataqueABandera"); }
      if (llevaBanderaAmiga) { nota += pesos.portadorNoPelea; apuntar("portadorNoPelea"); }
      if (a.hasta === ANILLO || a.hasta === TORRE) { nota += pesos.ataqueAlCastillo; apuntar("ataqueAlCastillo"); }

      // Rematar a quien el compañero ya tenía apuntado, o al que apunta a los
      // nuestros, vale más que un ataque suelto.
      if (objetivo && analisis.presionadasPorSocio.has(objetivo.id)) { nota += pesos.amenazaCombinada; apuntar("amenazaCombinada"); }
      if (objetivo && analisis.apuntanALosMios.has(objetivo.id)) { nota += pesos.contraAmenaza; apuntar("contraAmenaza"); }
    }

    if (devolverTodas) puntuadas.push({ accion: a, nota });
    if (nota > mejorNota) {
      mejorNota = nota;
      mejor = a;
    }
  }
  if (devolverTodas) {
    puntuadas.sort((x, y) => y.nota - x.nota);
    return puntuadas;
  }
  return mejor;
}

// --- Decidir si se recoge una bandera del suelo -------------------------------
// Recoger dejó de ser automático, así que el bot necesita criterio. Cargar con
// una bandera cuesta movilidad: el portador queda a un paso por turno.

const GENERAL = 8;

export function decisionDeRecogida(estado, color) {
  const pendiente = estado.pendiente;
  if (!pendiente || pendiente.tipo !== "recoger") return false;
  const pieza = estado.piezas[pendiente.pieza];
  if (!pieza) return false;

  // La bandera del propio bando se recoge siempre: es la que corona, y dejarla
  // en el suelo es servírsela al rival.
  if (!esEnemigo(color, pendiente.bandera)) return true;

  const bandera = estado.banderas[pendiente.bandera];
  const daPromocion = Boolean(bandera) && bandera.ultimoDueño === pendiente.bandera;
  // Una bandera enemiga sin promoción no compensa amarrar al mariscal ni al
  // general, que valen mucho más sueltos. El resto de la tropa sí la carga.
  if (!daPromocion && pieza.rango >= GENERAL) return false;
  return true;
}
