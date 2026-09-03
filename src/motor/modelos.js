// Cargar los modelos publicados desde disco.
//
// Vive aparte de `bot-red.js` porque usa `node:fs` y `bot-red.js` lo ejecuta
// TAMBIÉN el navegador: el informe de fin de partida analiza la partida en el
// cliente, y ahí no hay sistema de ficheros. Mezclarlos rompía la compilación
// del cliente entero.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desdeObjeto, ACTIVACION } from "./red.js";
import { TAMANO as TAMANO_DESPLIEGUE, FIRMA as FIRMA_DESPLIEGUE } from "./rasgos-despliegue.js";
import { TAMANO as TAMANO_JUGADA, FIRMA as FIRMA_JUGADA } from "./rasgos-jugada.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const CARPETA_MODELOS = path.join(AQUI, "modelos");

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
    // LA ACTIVACIÓN TAMBIÉN CUENTA. Al pasar de ReLU a leaky ReLU, un modelo
    // viejo se carga sin protestar y calcula OTRA COSA: mismos pesos, distinta
    // función. Es la misma trampa que la firma de los rasgos, y por eso lleva su
    // propia comprobación.
    const suya = guardado.activacion || "relu";
    if (suya !== ACTIVACION) {
      notas.push(
        `${etiqueta}: el modelo se entrenó con activación ${suya} y ahora se usa ${ACTIVACION}. ` +
          `Los mismos pesos calculan otra cosa: hay que reentrenar. Se juega con la heurística.`
      );
      return null;
    }
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
