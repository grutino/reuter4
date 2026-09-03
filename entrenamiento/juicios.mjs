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
import { rasgosDeDespliegue, FIRMA as FIRMA_DESPLIEGUE } from "../src/motor/rasgos-despliegue.js";
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

// --- Juicios de despliegue ----------------------------------------------------
//
// El mismo mecanismo, sobre la posición de salida en vez de sobre una jugada.
// Apostamos más por estos que por los de jugada, y por una razón de aritmética:
// un centenar de posiciones juzgadas no puede gobernar una política que toma
// cuatrocientas decisiones por partida, pero un despliegue es un objeto
// completo, se juzga una vez y su efecto se reparte por toda la partida. Cien
// juicios de despliegue son cien opiniones sobre cien objetos enteros.
//
// La clave del juicio lleva dentro la colocación, así que los pares se
// reconstruyen sin depender del fichero de parejas: se pueden regenerar las
// parejas cuando se quiera sin perder lo juzgado.

export function leerJuiciosDeDespliegue() {
  const ruta = path.join(CARPETA, "juicios-despliegue.json");
  if (!fs.existsSync(ruta)) return {};
  try {
    return JSON.parse(fs.readFileSync(ruta, "utf8")).juicios || {};
  } catch {
    return {};
  }
}

// "rojo:E1-3,E2-1,..." → { color, colocacion }
export function colocacionDesdeClave(clave) {
  const corte = clave.indexOf(":");
  if (corte < 0) return null;
  const color = clave.slice(0, corte);
  const colocacion = [];
  for (const trozo of clave.slice(corte + 1).split(",")) {
    const guion = trozo.lastIndexOf("-");
    if (guion < 0) return null;
    const casilla = trozo.slice(0, guion);
    const rango = Number(trozo.slice(guion + 1));
    if (!casilla || !Number.isInteger(rango)) return null;
    colocacion.push({ casilla, rango });
  }
  return { color, colocacion };
}

// "LOS DOS IGUAL" NO ES UNA SOLA COSA, y tratarlo como una sola tira información.
// Empatados arriba dice "los dos por encima de la media"; empatados abajo dice
// "los dos por debajo". Un empate sin signo no genera par y se pierde entero:
// eran el 17% de lo valorado y no estaban enseñando nada.
//
// Con el signo sí enseñan, y por una vía que las jugadas no permitirían: un
// despliegue es un objeto COMPLETO, se juzga en abstracto y no depende de la
// posición en que aparece, así que dos despliegues del mismo ejército juzgados
// en parejas distintas SÍ son comparables entre sí. Un "los dos flojos" se puede
// poner por debajo de cualquier ganador, y un "los dos buenos" por encima de
// cualquier perdedor.
//
// Esos pares cruzados pesan MENOS que los directos: comparar dentro de una
// pareja es lo que la persona vio y decidió; cruzarlos es una deducción nuestra.
export function paresDeDespliegue({ peso = 300, pesoCruzado = 0.35 } = {}) {
  const juicios = leerJuiciosDeDespliegue();
  const pares = [];
  const ganadores = [];   // preferidos dentro de su pareja, por color
  const perdedores = [];
  const flojos = [];      // los dos de una pareja marcada "los dos flojos"
  const buenos = [];
  let comparados = 0;
  let iguales = 0;

  for (const [clave, veredicto] of Object.entries(juicios)) {
    const barra = clave.indexOf("|");
    if (barra < 0) continue;
    const a = colocacionDesdeClave(clave.slice(0, barra));
    const b = colocacionDesdeClave(clave.slice(barra + 1));
    if (!a || !b || a.color !== b.color) continue;
    const rasgosDe = (x) => rasgosDeDespliegue(x.color, x.colocacion);

    if (veredicto === "a" || veredicto === "b") {
      const mejor = veredicto === "a" ? a : b;
      const peor = veredicto === "a" ? b : a;
      pares.push({ mejor: rasgosDe(mejor), peor: rasgosDe(peor), peso });
      ganadores.push({ color: mejor.color, entrada: rasgosDe(mejor) });
      perdedores.push({ color: peor.color, entrada: rasgosDe(peor) });
      comparados++;
      continue;
    }

    iguales++;
    // "iguales" a secas es el formato viejo, de cuando la página no distinguía:
    // no se puede saber de qué lado del listón estaban, así que no genera nada.
    if (veredicto === "ambosMalos") {
      flojos.push({ color: a.color, entrada: rasgosDe(a) }, { color: b.color, entrada: rasgosDe(b) });
    } else if (veredicto === "ambosBuenos") {
      buenos.push({ color: a.color, entrada: rasgosDe(a) }, { color: b.color, entrada: rasgosDe(b) });
    }
  }

  // Los cruces, solo dentro del mismo ejército: la zona de cada uno es distinta
  // y sus rasgos no significan lo mismo.
  let cruzados = 0;
  const cruzar = (arriba, abajo) => {
    for (const x of arriba) {
      for (const y of abajo) {
        if (x.color !== y.color) continue;
        pares.push({ mejor: x.entrada, peor: y.entrada, peso: peso * pesoCruzado });
        cruzados++;
      }
    }
  };
  cruzar(ganadores, flojos);
  cruzar(buenos, perdedores);
  cruzar(buenos, flojos);

  return {
    pares, comparados, iguales, cruzados,
    conSigno: flojos.length + buenos.length,
    total: Object.keys(juicios).length,
    firma: FIRMA_DESPLIEGUE,
  };
}
