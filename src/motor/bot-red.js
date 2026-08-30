// Los bots que juegan con la red entrenada.
//
// Vive en el motor y no en `entrenamiento/` porque el juego lo ejecuta: es lo
// que le permite al servidor mover un bot usando el modelo. Aquí solo hay
// INFERENCIA -elegir jugada, construir despliegue-; entrenar sigue estando
// fuera y el motor no importa nada de allí.
//
// Los modelos son artefactos: JSON de números en `src/motor/modelos/`, puestos
// ahí por `npm run publicar-redes`. Si no están, o si su número de entradas no
// coincide con los rasgos de esta versión del código, `cargarModelos` devuelve
// nulos y los bots juegan con la heurística de siempre. Esa comprobación no es
// decorativa: al añadir rasgos, un modelo viejo se carga sin dar ningún error y
// juega con basura.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluar, desdeObjeto } from "./red.js";
import { despliegueAleatorio, puntuarAcciones, PESOS_BASE, DISTANCIA } from "./bot.js";
import { NIVELES, nivelValido } from "./dificultad.js";
import { analizarTurno } from "./analisis.js";
import { rasgosDeDespliegue, TAMANO as TAMANO_DESPLIEGUE, FIRMA as FIRMA_DESPLIEGUE } from "./rasgos-despliegue.js";
import { rasgosDeJugada, contextoDeTurno, TAMANO as TAMANO_JUGADA, FIRMA as FIRMA_JUGADA } from "./rasgos-jugada.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const CARPETA_MODELOS = path.join(AQUI, "modelos");

export function despliegueGuiado(color, azar, red, candidatos = 40, escalada = 250) {
  // Primero, el mejor de unos cuantos al azar, como punto de partida.
  let mejor = null;
  let mejorNota = -Infinity;
  for (let i = 0; i < candidatos; i++) {
    const propuesta = despliegueAleatorio(color, azar);
    const nota = evaluar(red, rasgosDeDespliegue(color, propuesta));
    if (nota > mejorNota) {
      mejorNota = nota;
      mejor = propuesta;
    }
  }

  // Y después, recocido: se proponen intercambios y se acepta el que mejora,
  // pero también, con probabilidad decreciente, alguno que empeora.
  //
  // Con escalada pura -aceptando solo mejoras- la búsqueda se queda en el
  // óptimo convencional más cercano y nunca llega a probar cosas raras: poner
  // la bandera sobre un cañón, o sobre el espía. Esas jugadas parecen malas
  // hasta que se ven en contexto, y son justo las que dan sorpresa. Para que el
  // modelo pueda descubrirlas por su cuenta hay que dejarle bajar antes de
  // subir. La casilla de la bandera se intercambia como cualquier otra, así que
  // también decide qué rango la lleva.
  const actual = mejor.map((p) => ({ ...p }));
  let notaActual = mejorNota;
  let mejorCopia = actual.map((p) => ({ ...p }));
  for (let paso = 0; paso < escalada; paso++) {
    const temperatura = 0.03 * (1 - paso / escalada); // se enfría hasta cero
    const i = Math.floor(azar() * actual.length);
    const j = Math.floor(azar() * actual.length);
    if (i === j || actual[i].rango === actual[j].rango) continue;
    const t = actual[i].rango;
    actual[i].rango = actual[j].rango;
    actual[j].rango = t;
    const nota = evaluar(red, rasgosDeDespliegue(color, actual));
    const salto = nota - notaActual;
    if (salto > 0 || (temperatura > 0 && azar() < Math.exp(salto / temperatura))) {
      notaActual = nota;
      if (nota > mejorNota) {
        mejorNota = nota;
        mejorCopia = actual.map((p) => ({ ...p }));
      }
    } else {
      actual[j].rango = actual[i].rango;
      actual[i].rango = t;
    }
  }
  return mejorCopia;
}

export function accionConRed(estado, color, red, { candidatas = 12, azar = Math.random, pesos = PESOS_BASE } = {}) {
  const puntuadas = puntuarAcciones(estado, color, { pesos, azar });
  if (!puntuadas.length) return null;
  const finalistas = puntuadas.slice(0, Math.min(candidatas, puntuadas.length));
  if (finalistas.length === 1) return finalistas[0].accion;

  const contexto = contextoDeTurno(estado, color, analizarTurno(estado, color, DISTANCIA));
  let mejor = finalistas[0].accion;
  let mejorValor = -Infinity;
  for (const { accion } of finalistas) {
    const valor = evaluar(red, rasgosDeJugada(estado, color, accion, contexto));
    if (valor > mejorValor) {
      mejorValor = valor;
      mejor = accion;
    }
  }
  return mejor;
}

// --- Cargar los modelos publicados -------------------------------------------

// Devuelve `{ despliegue, jugada, notas }`. Cualquiera de los dos puede ser
// null, y el juego tiene que funcionar igual: los bots caen a la heurística.
export function cargarModelos(carpeta = CARPETA_MODELOS) {
  const notas = [];
  const uno = (fichero, tamano, firma, etiqueta) => {
    const ruta = path.join(carpeta, fichero);
    if (!fs.existsSync(ruta)) {
      notas.push(`${etiqueta}: no hay modelo publicado, se juega con la heurística`);
      return null;
    }
    let guardado;
    try {
      guardado = JSON.parse(fs.readFileSync(ruta, "utf8"));
    } catch (e) {
      notas.push(`${etiqueta}: el modelo no se puede leer (${e.message}), se juega con la heurística`);
      return null;
    }
    if (!guardado || !guardado.red || !Array.isArray(guardado.red.capas)) {
      notas.push(`${etiqueta}: el fichero no tiene una red dentro, se juega con la heurística`);
      return null;
    }
    // La comprobación que importa: un modelo entrenado con otro juego de rasgos
    // se carga sin protestar y juega con basura.
    if (guardado.red.capas[0] !== tamano) {
      notas.push(
        `${etiqueta}: el modelo espera ${guardado.red.capas[0]} entradas y los rasgos de esta versión dan ${tamano}. ` +
          `Está obsoleto: hay que reentrenar y volver a publicar. Se juega con la heurística.`
      );
      return null;
    }
    // Y el tamaño no basta. `juntoALago` pasó a ser `cubiertoPorLago` sin cambiar
    // cuántas entradas hay: un modelo viejo habría pasado la comprobación de
    // arriba y habría seguido jugando, con un peso entrenado sobre un cero
    // constante recibiendo de pronto valores que varían.
    if (guardado.firmaRasgos !== firma) {
      notas.push(
        `${etiqueta}: el modelo se entrenó con otros rasgos (firma ${guardado.firmaRasgos || "ninguna"}, ahora ${firma}). ` +
          `Mismo número de entradas pero distinto significado: hay que reentrenar. Se juega con la heurística.`
      );
      return null;
    }
    notas.push(
      `${etiqueta}: modelo cargado` +
        (guardado.victoriasEnJuego !== undefined ? ` (${Math.round(guardado.victoriasEnJuego * 100)}% contra el panel)` : "") +
        (guardado.creado ? `, del ${guardado.creado.slice(0, 10)}` : "")
    );
    return desdeObjeto(guardado.red);
  };

  return {
    despliegue: uno("red-despliegue.json", TAMANO_DESPLIEGUE, FIRMA_DESPLIEGUE, "despliegue"),
    jugada: uno("red-jugada.json", TAMANO_JUGADA, FIRMA_JUGADA, "jugada"),
    notas,
  };
}

// --- Un bot con nivel de dificultad ------------------------------------------

// De entre cuántas jugadas razonables sale el fallo. Es aparte de `candidatas`,
// que es cuántas evalúa la red: en los niveles bajos la red no interviene y
// `candidatas` vale 1, así que si el ruido eligiera entre las candidatas no
// haría nada nunca. Y el fallo se saca de entre las mejores, no de entre todas:
// un bot que juega cualquier cosa no es más fácil, es otro juego.
const POOL_DE_FALLO = 6;

// Un bot sin memoria no ve `rangosRevelados`. Se le pasa una vista con la
// memoria vacía en vez de usar `accionDeBotClasico`, que se conserva como vara
// de medir del duelo de `npm run simular` y no debe acabar atada a esto: si un
// día se cambia el nivel 1, no puede arrastrar consigo la referencia.
// La copia es superficial a propósito: `piezas` y `tablero` van por referencia y
// nadie los toca, así que no cuesta nada por jugada.
const vistaSegunNivel = (estado, cfg) => (cfg.memoria ? estado : { ...estado, rangosRevelados: {} });

export function jugadaDeBot(estado, color, nivel, modelos = {}, azar = Math.random) {
  const cfg = NIVELES[nivelValido(nivel)];
  const visto = vistaSegunNivel(estado, cfg);
  const puntuadas = puntuarAcciones(visto, color, { azar });
  if (!puntuadas.length) return null;

  if (cfg.ruido > 0 && azar() < cfg.ruido) {
    const pool = puntuadas.slice(0, Math.min(POOL_DE_FALLO, puntuadas.length));
    return pool[Math.floor(azar() * pool.length)].accion;
  }

  const finalistas = puntuadas.slice(0, Math.max(1, Math.min(cfg.candidatas, puntuadas.length)));
  if (!cfg.red || !modelos.jugada || finalistas.length === 1) return finalistas[0].accion;

  const contexto = contextoDeTurno(visto, color, analizarTurno(visto, color, DISTANCIA));
  let mejor = finalistas[0].accion;
  let mejorValor = -Infinity;
  for (const { accion } of finalistas) {
    const valor = evaluar(modelos.jugada, rasgosDeJugada(visto, color, accion, contexto));
    if (valor > mejorValor) { mejorValor = valor; mejor = accion; }
  }
  return mejor;
}

export function despliegueDeBot(color, nivel, modelos = {}, azar = Math.random) {
  const cfg = NIVELES[nivelValido(nivel)];
  if (!cfg.red || !modelos.despliegue || !cfg.candidatosDespliegue) return despliegueAleatorio(color, azar);
  return despliegueGuiado(color, azar, modelos.despliegue, cfg.candidatosDespliegue, cfg.escalada);
}
