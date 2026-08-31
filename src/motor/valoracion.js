// Quién iba ganando cuando la partida no llegó a decidirse.
//
// Vive en el motor y no en `entrenamiento/` porque es lógica del JUEGO -mide
// quién estaba más cerca de coronar- y la usan tanto el entrenamiento como el
// análisis de fin de partida, que corre en el navegador.
//
// De dónde sale: dos bots al azar dan ocho tablas de ocho, así que con solo
// victoria/derrota la fase de arranque no tiene gradiente ninguno. Esto reparte
// esas tablas según quién estaba más cerca de ganar, y es lo que permitió que el
// entrenamiento despegara.

import { DISTANCIA } from "./bot.js";
import { EQUIPOS } from "./motor.js";

const [EQUIPO_A, EQUIPO_B] = EQUIPOS;

function distanciaDeBanderaAlCastillo(estado, equipo) {
  let mejor = 40;
  for (const color of equipo) {
    const bandera = estado.banderas[color];
    if (!bandera) continue;
    let casilla = null;
    if (bandera.portador && estado.piezas[bandera.portador]) casilla = estado.piezas[bandera.portador].casilla;
    else if (bandera.casilla) casilla = bandera.casilla;
    if (!casilla) continue;
    const d = DISTANCIA[casilla];
    if (d !== undefined && d < mejor) mejor = d;
  }
  return mejor;
}

function materialDe(estado, equipo) {
  let total = 0;
  for (const p of Object.values(estado.piezas)) if (equipo.includes(p.color)) total += p.rango;
  return total;
}

function victoriasDe(estado, equipo) {
  return equipo.reduce((s, c) => s + (estado.marcador[c] || 0), 0);
}

// Devuelve entre 0 y 1 cuánto le corresponde al equipo A de una partida sin
// ganador: 0,5 si están igualados.
export function repartoDeTablas(estado) {
  const dA = distanciaDeBanderaAlCastillo(estado, EQUIPO_A);
  const dB = distanciaDeBanderaAlCastillo(estado, EQUIPO_B);
  const ventaja =
    0.30 * (dB - dA) +          // quién tiene su bandera más cerca de la torre
    0.02 * (materialDe(estado, EQUIPO_A) - materialDe(estado, EQUIPO_B)) +
    0.25 * (victoriasDe(estado, EQUIPO_A) - victoriasDe(estado, EQUIPO_B));
  return 0.5 + 0.5 * Math.tanh(ventaja / 3);
}
