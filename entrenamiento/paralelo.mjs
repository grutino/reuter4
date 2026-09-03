// Piscina de obreros para repartir partidas entre núcleos.
//
// Los obreros se levantan una vez y se reutilizan. Antes se creaban en cada
// tanda y el entrenamiento iba tres veces más lento de lo que debía: arrancar
// un hilo y cargar el motor cuesta mucho más que jugar la partida que se le
// pide. Con la piscina, una generación pasa de decenas de segundos a unos pocos.

import { Worker } from "node:worker_threads";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enfrentar } from "./arena.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const NUCLEOS = Math.max(1, os.cpus().length - 1); // uno se deja libre

// `guion` dice qué obrero se levanta. "obrero.mjs" juega enfrentamientos y
// devuelve marcadores; "obrero-tanda.mjs" juega la tanda de coevolución y
// devuelve los ejemplos de entrenamiento. El reparto de encargos es el mismo,
// solo cambia lo que va y lo que vuelve.
export function crearPiscina(nucleos = NUCLEOS, guion = "obrero.mjs") {
  if (nucleos <= 1) {
    return {
      nucleos: 1,
      ejecutar: async (tareas) => tareas.map((t) => enfrentar(t.configA, t.configB, t.parejas, t.semillaBase, t.limite)),
      cerrar: async () => {},
    };
  }

  const obreros = Array.from({ length: nucleos }, () => new Worker(path.join(AQUI, guion)));
  const libres = [...obreros];
  const cola = [];
  const pendientes = new Map();
  let siguienteId = 0;

  function asignar() {
    while (libres.length && cola.length) {
      const obrero = libres.pop();
      const encargo = cola.shift();
      pendientes.set(encargo.id, { encargo, obrero });
      obrero.postMessage({ id: encargo.id, tarea: encargo.tarea });
    }
  }

  for (const obrero of obreros) {
    obrero.on("message", ({ id, resultado, error }) => {
      const registro = pendientes.get(id);
      if (!registro) return;
      pendientes.delete(id);
      libres.push(registro.obrero);
      if (error) registro.encargo.rechazar(new Error(error));
      else registro.encargo.resolver(resultado);
      asignar();
    });
    obrero.on("error", (e) => {
      for (const [id, r] of pendientes) {
        if (r.obrero === obrero) {
          pendientes.delete(id);
          r.encargo.rechazar(e);
        }
      }
    });
  }

  return {
    nucleos,
    // Reparte por encargos sueltos y no por bloques fijos: las partidas no
    // duran lo mismo y así ningún hilo se queda esperando al más lento.
    ejecutar(tareas) {
      return Promise.all(
        tareas.map(
          (tarea) =>
            new Promise((resolver, rechazar) => {
              cola.push({ id: siguienteId++, tarea, resolver, rechazar });
              asignar();
            })
        )
      );
    },
    async cerrar() {
      await Promise.all(obreros.map((o) => o.terminate()));
    },
  };
}

// Parte un combate largo en trozos para que lo jueguen varios hilos a la vez.
// Cada trozo lleva su propio desplazamiento de semilla, así que no se repiten
// partidas, y el resultado sumado es el mismo que en un solo hilo.
export function trocear(configA, configB, parejas, semillaBase, trozos, limite) {
  const porTrozo = Math.ceil(parejas / trozos);
  const tareas = [];
  let hechas = 0;
  while (hechas < parejas) {
    const cuantas = Math.min(porTrozo, parejas - hechas);
    tareas.push({ configA, configB, parejas: cuantas, semillaBase: semillaBase + hechas * 7919, limite });
    hechas += cuantas;
  }
  return tareas;
}

export function sumar(resultados) {
  const total = { a: 0, b: 0, tablas: 0, turnos: 0, partidas: 0, errores: 0, puntosA: 0 };
  for (const r of resultados) {
    total.a += r.a;
    total.b += r.b;
    total.tablas += r.tablas;
    total.turnos += r.turnos;
    total.partidas += r.partidas;
    total.errores += r.errores;
    total.puntosA += r.puntosA || 0;
  }
  const decididas = total.a + total.b;
  total.tasaA = decididas ? total.a / decididas : 0.5;
  total.turnosMedia = total.partidas ? Math.round(total.turnos / total.partidas) : 0;
  total.puntuacionA = total.partidas ? total.puntosA / total.partidas : 0.5;
  return total;
}
