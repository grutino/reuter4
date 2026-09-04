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

import { evaluar } from "./red.js";
import { movimientosLegales, banderaQueCorona, aplicar, sonAliados } from "./motor.js";
import { TORRE } from "./tablero.js";
import { despliegueAleatorio, puntuarAcciones, PESOS_BASE, DISTANCIA } from "./bot.js";
import { configuracionDeBot } from "./dificultad.js";
import { analizarTurno } from "./analisis.js";
import { rasgosDeDespliegue } from "./rasgos-despliegue.js";
import { rasgosDeJugada, contextoDeTurno } from "./rasgos-jugada.js";

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

// --- Mirando una jugada más allá ---------------------------------------------
//
// EL BOT NO MIRABA NADA. `aplicar` no aparecía ni una vez en bot.js, bot-red.js
// ni rasgos-jugada.js: se puntuaba el par (posición, jugada) desde el estado
// actual y se cogía el máximo. Medio ply, sin ver el tablero resultante ni la
// respuesta de nadie.
//
// Aquí se juega la jugada y se mira qué puede hacer el siguiente. Como la red
// evalúa pares (posición, jugada) y no posiciones sueltas, no se puede "evaluar
// el tablero resultante": lo que se hace es preguntarle a la MISMA red cuánto le
// gusta al siguiente en turno su mejor jugada desde ahí.
//
// En un juego de cuatro el siguiente no siempre es un enemigo. Si es el
// compañero, que tenga una buena jugada es bueno para mí, así que suma en vez de
// restar — y suma menos, porque su turno me ayuda menos de lo que me perjudica
// el de un rival.
export function accionConRedProfunda(
  estado, color, red,
  { candidatas = 12, respuestas = 6, peso = 0.6, pesoAliado = 0.3, azar = Math.random, pesos = PESOS_BASE } = {}
) {
  const puntuadas = puntuarAcciones(estado, color, { pesos, azar });
  if (!puntuadas.length) return null;
  const finalistas = puntuadas.slice(0, Math.min(candidatas, puntuadas.length));
  if (finalistas.length === 1) return finalistas[0].accion;

  const contexto = contextoDeTurno(estado, color, analizarTurno(estado, color, DISTANCIA));
  let mejor = finalistas[0].accion;
  let mejorValor = -Infinity;

  for (const { accion } of finalistas) {
    const mio = evaluar(red, rasgosDeJugada(estado, color, accion, contexto));

    let ajuste = 0;
    try {
      const despues = aplicar(estado, accion);
      // Una decisión pendiente congela el turno y no se sabe quién movería: se
      // deja la jugada con su valor a secas en vez de inventarse una respuesta.
      if (!despues.fin && !despues.pendiente) {
        const otro = despues.turno;
        const suyas = puntuarAcciones(despues, otro, { pesos, azar })
          .slice(0, respuestas)
          .map((x) => x.accion);
        if (suyas.length) {
          const suContexto = contextoDeTurno(despues, otro, analizarTurno(despues, otro, DISTANCIA));
          let suMejor = -Infinity;
          for (const a of suyas) {
            const v = evaluar(red, rasgosDeJugada(despues, otro, a, suContexto));
            if (v > suMejor) suMejor = v;
          }
          const aliado = sonAliados(estado, otro, color);
          ajuste = (aliado ? pesoAliado : -peso) * suMejor;
        }
      }
    } catch {
      // Si la jugada no se puede aplicar por lo que sea, vale su nota a secas.
    }

    const valor = mio + ajuste;
    if (valor > mejorValor) {
      mejorValor = valor;
      mejor = accion;
    }
  }
  return mejor;
}

// --- Un bot con nivel de dificultad ------------------------------------------

// De entre cuántas jugadas razonables sale el fallo. Es aparte de `candidatas`,
// que es cuántas evalúa la red: en los niveles bajos la red no interviene y
// `candidatas` vale 1, así que si el ruido eligiera entre las candidatas no
// haría nada nunca. Y el fallo se saca de entre las mejores, no de entre todas:
// un bot que juega cualquier cosa no es más fácil, es otro juego.
const POOL_DE_FALLO = 6;

// EL RUIDO NUNCA TIRA UNA VICTORIA. Un nivel bajo debe jugar peor, no regalar
// partidas ganadas: medido, el nivel 3 dejaba de coronar el 42% de las veces que
// podía hacerlo, y el 4 el 25%. Un humano flojo hace jugadas mediocres, no pasa
// de largo por delante de la torre con la bandera en la mano.
//
// Se mira antes de cualquier otra cosa, así que también salta por encima de la
// red: la red no sabe que esto GANA, solo estima probabilidades, y no hay
// probabilidad que valga cuando la partida se acaba aquí.
function jugadaQueGana(estado, color, acciones) {
  return acciones.find((a) => {
    if (a.hasta !== TORRE) return false;
    const pieza = estado.piezas[a.pieza];
    return pieza && pieza.color === color && banderaQueCorona(estado, pieza);
  });
}

// Un bot sin memoria no ve `rangosRevelados`. Se le pasa una vista con la
// memoria vacía en vez de usar `accionDeBotClasico`, que se conserva como vara
// de medir del duelo de `npm run simular` y no debe acabar atada a esto: si un
// día se cambia el nivel 1, no puede arrastrar consigo la referencia.
// La copia es superficial a propósito: `piezas` y `tablero` van por referencia y
// nadie los toca, así que no cuesta nada por jugada.
const vistaSegunMemoria = (estado, cfg) => (cfg.memoria ? estado : { ...estado, rangosRevelados: {} });

export function jugadaDeBot(estado, color, modelos = {}, azar = Math.random) {
  const cfg = configuracionDeBot(Boolean(modelos.jugada));
  const visto = vistaSegunMemoria(estado, cfg);
  const puntuadas = puntuarAcciones(visto, color, { azar });
  if (!puntuadas.length) return null;

  // Aunque ya no haya ruido que pueda tirarla, se comprueba primero: es la
  // jugada que acaba la partida y no depende de lo que opine ninguna red.
  const ganadora = jugadaQueGana(visto, color, puntuadas.map((p) => p.accion));
  if (ganadora) return ganadora;

  const finalistas = puntuadas.slice(0, Math.max(1, Math.min(cfg.candidatas, puntuadas.length)));
  if (!cfg.red || !modelos.jugada || finalistas.length === 1) return finalistas[0].accion;

  // Mirar la respuesta del siguiente antes de decidir. Se llama aquí y no dentro
  // del bucle de abajo porque `accionConRedProfunda` repite la criba: es el
  // precio de que sirva también fuera del juego, para medir.
  if (cfg.profundo) {
    return accionConRedProfunda(visto, color, modelos.jugada, { candidatas: cfg.candidatas, azar });
  }

  const contexto = contextoDeTurno(visto, color, analizarTurno(visto, color, DISTANCIA));
  let mejor = finalistas[0].accion;
  let mejorValor = -Infinity;
  for (const { accion } of finalistas) {
    const valor = evaluar(modelos.jugada, rasgosDeJugada(visto, color, accion, contexto));
    if (valor > mejorValor) { mejorValor = valor; mejor = accion; }
  }
  return mejor;
}

export function despliegueDeBot(color, modelos = {}, azar = Math.random) {
  const cfg = configuracionDeBot(Boolean(modelos.despliegue));
  if (!cfg.red || !modelos.despliegue || !cfg.candidatosDespliegue) return despliegueAleatorio(color, azar);
  return despliegueGuiado(color, azar, modelos.despliegue, cfg.candidatosDespliegue, cfg.escalada);
}

// --- Decidir con la red SOLA, sin heurística ---------------------------------
//
// La heurística no solo puntúa: hoy es quien elige las cuatro candidatas que ve
// la red. Esto es el camino sin ella — la red puntúa TODAS las jugadas legales.
//
// Y sale más barato, que era lo que no esperaba: medido, la heurística cuesta
// 0,42 ms por turno y los rasgos de una jugada 0,006. Con 28 jugadas legales de
// media, puntuarlas todas con la red son 0,59 ms frente a los 0,87 de pasar
// antes por la heurística. El cuello de botella es el análisis del turno, que se
// hace una sola vez en los dos casos.
export function jugadaSoloRed(estado, color, red, { azar = Math.random, ruido = 0, memoria = true } = {}) {
  const visto = memoria ? estado : { ...estado, rangosRevelados: {} };
  const legales = movimientosLegales(visto, color);
  if (!legales.length) return null;
  if (legales.length === 1) return legales[0];

  const ganadora = jugadaQueGana(visto, color, legales);
  if (ganadora) return ganadora;

  const contexto = contextoDeTurno(visto, color, analizarTurno(visto, color, DISTANCIA));
  const notas = legales.map((accion) => ({
    accion,
    nota: evaluar(red, rasgosDeJugada(visto, color, accion, contexto)),
  }));
  notas.sort((a, b) => b.nota - a.nota);

  if (ruido > 0 && azar() < ruido) {
    const pool = notas.slice(0, Math.min(POOL_DE_FALLO, notas.length));
    return pool[Math.floor(azar() * pool.length)].accion;
  }
  return notas[0].accion;
}
