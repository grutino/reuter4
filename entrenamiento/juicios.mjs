// Los juicios humanos, convertidos en algo que la red pueda aprender.
//
// Un juicio no es un valor —nadie sabe decir "esta jugada gana el 63% de las
// veces"— sino un ORDEN: buena va por delante de indefinida, e indefinida por
// delante de mala. Eso se entrena con la pérdida por pares, la misma que usa la
// destilación de la heurística.
//
// POR QUÉ VALE LA PENA aunque haya pocos. Los rollouts miden en la moneda del
// juego, pero son ruidosos: la misma posición medida dos veces con 8 tiradas
// solo correlaciona 0,39 consigo misma. Hay muchísimas posiciones que la máquina
// no puede decidir por más cómputo que se le eche, y ahí un juicio aporta lo
// único que no se puede comprar. Por eso pesan mucho más que un par cualquiera:
// hay decenas contra cientos de miles.
//
// Y solo se comparan jugadas de LA MISMA posición. Comparar una jugada buena de
// una posición con una mala de otra no dice nada: la primera puede ser buena
// porque la posición era fácil.

import fs from "node:fs";
import path from "node:path";
import { DISTANCIA } from "../src/motor/bot.js";
import { analizarTurno } from "../src/motor/analisis.js";
import { rasgosDeJugada, contextoDeTurno, FIRMA as FIRMA_JUGADA } from "../src/motor/rasgos-jugada.js";
import { movimientosLegales } from "../src/motor/motor.js";
import { leerBanco, claveDeJuicio, CARPETA } from "./escenarios.mjs";

const ORDEN = { buena: 2, indefinida: 1, mala: 0 };

export function leerJuicios() {
  const ruta = path.join(CARPETA, "juicios.json");
  if (!fs.existsSync(ruta)) return {};
  try {
    return JSON.parse(fs.readFileSync(ruta, "utf8")).juicios || {};
  } catch {
    return {};
  }
}

// Pares (mejor, peor) sacados de los juicios, agrupados por posición.
export function paresDeJuicios({ peso = 300 } = {}) {
  const juicios = leerJuicios();
  if (!Object.keys(juicios).length) return { pares: [], posiciones: 0, juzgadas: 0 };

  const banco = leerBanco();
  const pares = [];
  let posiciones = 0;
  let juzgadas = 0;

  for (const escenario of banco) {
    const { estado, color } = escenario;
    const legales = movimientosLegales(estado, color);
    const conJuicio = [];
    for (const accion of legales) {
      const veredicto = juicios[claveDeJuicio(estado, color, accion)];
      if (veredicto === undefined) continue;
      conJuicio.push({ accion, nivel: ORDEN[veredicto] });
      juzgadas++;
    }
    // Con una sola jugada juzgada no hay orden que aprender: hacen falta dos
    // que se puedan comparar, y de niveles distintos.
    if (conJuicio.length < 2) continue;

    const contexto = contextoDeTurno(estado, color, analizarTurno(estado, color, DISTANCIA));
    const rasgos = conJuicio.map((x) => ({ ...x, entrada: rasgosDeJugada(estado, color, x.accion, contexto) }));
    let algunPar = false;
    for (const a of rasgos) {
      for (const b of rasgos) {
        if (a.nivel <= b.nivel) continue;
        // Un salto de dos escalones -buena contra mala- pesa el doble que uno.
        pares.push({ mejor: a.entrada, peor: b.entrada, peso: peso * (a.nivel - b.nivel) });
        algunPar = true;
      }
    }
    if (algunPar) posiciones++;
  }

  return { pares, posiciones, juzgadas, firma: FIRMA_JUGADA };
}

export function resumenDeJuicios() {
  const juicios = leerJuicios();
  const cuenta = { buena: 0, mala: 0, indefinida: 0 };
  for (const v of Object.values(juicios)) if (cuenta[v] !== undefined) cuenta[v]++;
  return { total: Object.keys(juicios).length, ...cuenta };
}
