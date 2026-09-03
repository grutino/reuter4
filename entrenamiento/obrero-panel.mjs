// Obrero que mide al aspirante contra UN rival del panel.
//
// Es el reparto que sí sale a cuenta. Medir contra el panel es lo que más pesa
// de una ronda -38s de 63s en la medida- y cada rival es independiente de los
// demás. Y sobre todo: lo único que vuelve son tres números, mientras que
// repartir la tanda de coevolución obligaba a mover cien mil vectores de
// vuelta y salía cuatro veces más lento que no repartir nada.
//
// El aspirante no se puede mandar tal cual porque son funciones. Se manda con
// qué juega -las redes serializadas y las opciones- y el obrero lo reconstruye
// exactamente igual que lo haría el padre.

import { parentPort } from "node:worker_threads";
import { medirContraUnRival } from "./panel.mjs";
import { desdeObjeto } from "../src/motor/red.js";
import { despliegueGuiado, jugadaSoloRed, accionConRed } from "../src/motor/bot-red.js";
import { despliegueAleatorio, accionDeBot } from "../src/motor/bot.js";

parentPort.on("message", ({ id, tarea }) => {
  try {
    const rd = tarea.redD ? desdeObjeto(tarea.redD) : null;
    const rj = tarea.redJ ? desdeObjeto(tarea.redJ) : null;
    const o = tarea.o;
    const aspirante = {
      desplegar: (color, az) => (rd ? despliegueGuiado(color, az, rd, o.candidatos, o.escalada) : despliegueAleatorio(color, az)),
      jugar: (estado, color, az) =>
        !rj ? accionDeBot(estado, color, { azar: az })
        : o.soloRed ? jugadaSoloRed(estado, color, rj, { azar: az })
        : accionConRed(estado, color, rj, { candidatas: o.candidatas, azar: az }),
    };
    parentPort.postMessage({
      id,
      resultado: medirContraUnRival(aspirante, tarea.rival, { parejas: tarea.parejas, semillaBase: tarea.semillaBase, limite: tarea.limite }),
    });
  } catch (e) {
    parentPort.postMessage({ id, error: e.stack || e.message });
  }
});
