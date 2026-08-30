// Bots de Reuter4. Módulo compartido: lo usan el servidor y la simulación,
// para que lo que se mide sea exactamente lo que se juega.
//
// Regla de oro: un bot solo puede mirar información pública. Corre dentro del
// servidor, con el estado completo a mano, así que la tentación de leer
// `estado.piezas[id].rango` de una pieza enemiga está a un carácter de distancia.
// No se hace. La única fuente sobre rangos ajenos es `estado.rangosRevelados`,
// que el motor alimenta con lo que ha quedado a la vista de toda la mesa.

import { ANILLO, TORRE, ADYACENTES, ZONAS, casillasDeZona } from "./tablero.js";
import {
  RANGOS,
  MARISCAL,
  ESPIA,
  movimientosLegales,
  inventarioInicial,
  resolverDuelo,
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

export function barajar(lista) {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

export function despliegueAleatorio(color) {
  const zona = casillasDeZona(color).filter((c) => c !== ZONAS[color].reclutamiento);
  const casillaBandera = ZONAS[color].bandera;
  const resto = barajar(zona.filter((c) => c !== casillaBandera));
  const usadas = [casillaBandera, ...resto.slice(0, 19)];
  const bolsa = barajar(inventarioInicial());
  return usadas.map((casilla, i) => ({ casilla, rango: bolsa[i], bandera: casilla === casillaBandera }));
}

// --- Bot clásico -------------------------------------------------------------
// El de siempre: posicional, sin memoria. Se conserva intacto como vara de medir
// en `npm run simular`. No lo toques para "mejorarlo": deja de ser referencia.

export function accionDeBotClasico(estado, color) {
  const acciones = movimientosLegales(estado, color);
  if (!acciones.length) return null;
  let mejor = null;
  let mejorNota = -Infinity;
  for (const a of acciones) {
    const pieza = estado.piezas[a.pieza];
    const propia = pieza.bandera && (pieza.bandera === color || SOCIO[color] === pieza.bandera);
    let nota = Math.random() * 2;
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
function bolsaOculta(estado, color) {
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
function valorEsperado(miRango, restantes) {
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
function amenazaConocida(estado, casilla, miRango, color) {
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

// --- Bot con memoria ---------------------------------------------------------

export function accionDeBot(estado, color) {
  const acciones = movimientosLegales(estado, color);
  if (!acciones.length) return null;

  const memoria = estado.rangosRevelados || {};
  const bolsas = {}; // prior de cada rival, calculado una vez por turno

  let mejor = null;
  let mejorNota = -Infinity;

  for (const a of acciones) {
    const pieza = estado.piezas[a.pieza];
    const llevaBanderaAmiga = pieza.bandera && (pieza.bandera === color || SOCIO[color] === pieza.bandera);
    let nota = Math.random() * 2;

    if (a.tipo === "mover") {
      const antes = DISTANCIA[a.desde] ?? 30;
      const despues = DISTANCIA[a.hasta] ?? 30;
      if (a.hasta === TORRE && llevaBanderaAmiga) nota += 10000;
      else if (llevaBanderaAmiga) nota += (antes - despues) * 14 + 6;
      else nota += (antes - despues) * 3;
      if (estado.banderasSueltas[a.hasta]) nota += 25;

      // Novedad: no meter la cabeza al lado de alguien que ya sabemos que nos gana.
      // Al portador de bandera le duele el doble, porque su caída suelta la bandera.
      const amenaza = amenazaConocida(estado, a.hasta, pieza.rango, color);
      if (amenaza && !llevaBanderaAmiga) nota -= 3 + amenaza;
    }

    if (a.tipo === "disparar") {
      // El cañón se retira al disparar, así que el disparo vale lo que se lleva
      // por delante. Contra un rango conocido se puede afinar; si no, media.
      const objetivo = estado.piezas[estado.tablero[a.hasta]];
      const conocido = objetivo ? memoria[objetivo.id] : undefined;
      if (conocido !== undefined) nota += 20 + conocido * 7;
      else nota += 45;
      if (objetivo && objetivo.bandera) nota += 40;
    }

    if (a.tipo === "atacar") {
      const objetivo = estado.piezas[estado.tablero[a.hasta]];
      const conocido = objetivo ? memoria[objetivo.id] : undefined;
      nota += 0;

      if (conocido !== undefined) {
        const res = resolverDuelo(pieza.rango, conocido);
        if (res === "atacante") nota += 30 + conocido * 6; // captura segura
        else if (res === "empate") nota -= 12; // intercambio parejo, rara vez interesa
        else nota -= 120; // suicidio a sabiendas
        // El espía existe para esto y para nada más.
        if (pieza.rango === ESPIA && conocido === MARISCAL) nota += 90;
      } else {
        if (!bolsas[objetivo.color]) bolsas[objetivo.color] = bolsaOculta(estado, objetivo.color);
        nota += valorEsperado(pieza.rango, bolsas[objetivo.color]) * 4;
      }

      // Quien lleva una bandera es objetivo prioritario, sea de quien sea:
      // si es enemiga se captura, y si es nuestra se recupera.
      if (objetivo && objetivo.bandera) nota += 60;
      if (llevaBanderaAmiga) nota -= 60; // el portador no se mete en peleas
      if (a.hasta === ANILLO || a.hasta === TORRE) nota += 20;
    }

    if (nota > mejorNota) {
      mejorNota = nota;
      mejor = a;
    }
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
