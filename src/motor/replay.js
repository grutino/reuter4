// Reproducir una partida terminada, jugada a jugada.
//
// El hilo guarda lo justo para volver a montarla: cada entrada dice de qué tipo
// es y las de resolución traen su propio tipo (`recoger`, `renunciar-recoger`,
// `reclutar`, `renunciar`), así que no hay que adivinar qué decidió nadie. El
// rango del recluta también está —tapado hasta el final— y sin él el replay
// perdía a esa pieza y a todo lo que hiciera después.
//
// PARA QUÉ. Para poder preguntarle a una partida terminada qué jugadas la
// decidieron. Con los estados en la mano se puede evaluar cada posición, ver
// dónde pega un salto la valoración, y probar allí las alternativas. Sin ellos
// solo se puede contar lo que pasó, que es lo que hace el informe hoy.

import { COLORES } from "./tablero.js";
import { nuevaPartida, aplicar, movimientosLegales, reclutar, recogerLaBandera, renunciarARecoger, renunciarAlReclutamiento } from "./motor.js";

const MISMA = (a, h) =>
  a.tipo === h.tipo && a.desde === h.desde && a.hasta === h.hasta && (a.via || null) === (h.via || null);

export class ReplayImposible extends Error {}

// Devuelve un paso por cada entrada del hilo: el estado ANTES de aplicarla, la
// entrada, y a quién le tocaba. El estado final va aparte.
export function reproducirPartida(despliegues, historia) {
  const hilo = historia || [];
  if (!hilo.length) throw new ReplayImposible("el hilo está vacío");
  // Si le falta el principio no hay nada que hacer: el replay parte del
  // despliegue inicial y sin las primeras jugadas ya no sabe quién está dónde.
  if (hilo[0].n > 1) throw new ReplayImposible(`el hilo empieza en la jugada ${hilo[0].n}, no en la 1`);
  for (const color of COLORES) {
    if (!despliegues || !despliegues[color]) throw new ReplayImposible(`falta el despliegue de ${color}`);
  }

  let estado = nuevaPartida(despliegues, { primero: hilo[0].color });
  const pasos = [];

  for (const entrada of hilo) {
    pasos.push({ n: entrada.n, color: entrada.color, entrada, estado });

    if (entrada.tipo === "recoger") { estado = recogerLaBandera(estado); continue; }
    if (entrada.tipo === "renunciar-recoger") { estado = renunciarARecoger(estado); continue; }
    if (entrada.tipo === "renunciar") { estado = renunciarAlReclutamiento(estado); continue; }
    if (entrada.tipo === "reclutar") {
      if (entrada.rango === undefined) {
        throw new ReplayImposible(`la jugada ${entrada.n} recluta y el hilo no trae el rango (¿venía censurado?)`);
      }
      estado = reclutar(estado, entrada.rango);
      continue;
    }

    const legales = movimientosLegales(estado, entrada.color);
    const accion = legales.find((a) => MISMA(a, entrada));
    if (!accion) {
      throw new ReplayImposible(
        `la jugada ${entrada.n} (${entrada.color} ${entrada.tipo} ${entrada.desde}->${entrada.hasta}) no es legal al reproducirla`
      );
    }
    pasos[pasos.length - 1].accion = accion;
    estado = aplicar(estado, accion);
  }

  return { pasos, estadoFinal: estado };
}

// Los pasos que son una JUGADA de verdad —no una decisión pendiente—, que son
// los únicos donde tenía sentido preguntarse si se pudo hacer otra cosa.
export function pasosConAlternativas(pasos) {
  return pasos.filter((p) => p.accion);
}
