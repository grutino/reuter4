// Obrero de un hilo. Se arranca una vez y se queda esperando encargos: cargar
// el motor y dejar que el JIT lo compile cuesta bastante más que jugar una
// partida, así que levantar obreros nuevos en cada generación era el grueso del
// tiempo de entrenamiento.

import { parentPort } from "node:worker_threads";
import { enfrentar } from "./arena.mjs";

parentPort.on("message", ({ id, tarea }) => {
  try {
    parentPort.postMessage({ id, resultado: enfrentar(tarea.configA, tarea.configB, tarea.parejas, tarea.semillaBase, tarea.limite) });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
