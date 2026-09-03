// Obrero que juega un trozo de la tanda de coevolución.
//
// A diferencia de `obrero.mjs`, que solo devuelve el marcador de un
// enfrentamiento, este devuelve los EJEMPLOS: los vectores de rasgos con su
// etiqueta, que son el material de entrenamiento. Son muchos —una tanda de 400
// partidas pasa de cien mil— así que las entradas viajan como Float64Array, que
// structuredClone copia de un tirón en vez de recorrer cien mil objetos.
//
// Las redes llegan serializadas y se reconstruyen una vez por encargo. Cargar el
// motor cuesta mucho más que jugar una partida, y por eso el obrero se queda
// vivo entre encargos.

import { parentPort } from "node:worker_threads";
import { jugarUna } from "./coevolucion.mjs";
import { desdeObjeto } from "../src/motor/red.js";
import { fuenteDeDespliegues } from "./aperturas.mjs";
import { despliegueAleatorio } from "../src/motor/bot.js";
import { cargarAperturas } from "./panel.mjs";

// Las aperturas humanas se leen del disco una sola vez por obrero.
const sacarDespliegue = fuenteDeDespliegues(cargarAperturas(), despliegueAleatorio);

parentPort.on("message", ({ id, tarea }) => {
  try {
    const redD = tarea.redD ? desdeObjeto(tarea.redD) : null;
    const redJ = tarea.redJ ? desdeObjeto(tarea.redJ) : null;
    const deDespliegue = [];
    const deJugada = [];
    const pares = [];
    let decididas = 0;
    // Lo que gana cada formación, por índice: el padre lo suma con lo de los
    // demás obreros y así el reparto sale igual que en un solo hilo.
    const ganancias = new Map();

    for (const { i, formacion } of tarea.partidas) {
      const r = jugarUna(i, redD, redJ, tarea.o, tarea.semillaBase, sacarDespliegue, formacion);
      for (const x of r.deDespliegue) deDespliegue.push(x);
      for (const x of r.deJugada) deJugada.push(x);
      for (const x of r.pares) pares.push(x);
      decididas += r.decidida;
      if (formacion) {
        const previo = ganancias.get(formacion.indice) || { gana: 0, juega: 0 };
        ganancias.set(formacion.indice, { gana: previo.gana + r.gana, juega: previo.juega + 1 });
      }
    }

    parentPort.postMessage({
      id,
      resultado: { deDespliegue, deJugada, pares, decididas, ganancias: [...ganancias] },
    });
  } catch (e) {
    parentPort.postMessage({ id, error: e.stack || e.message });
  }
});
