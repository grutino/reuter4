// Entrenamiento por autojuego de los pesos de la heurística.
//
// Es una estrategia evolutiva con recombinación ponderada: se mantiene un
// vector medio, cada generación se muestrean descendientes alrededor de él, se
// evalúan contra un panel de rivales y la media se desplaza hacia el promedio
// ponderado de los mejores. Es el "self-play contra versiones anteriores" del
// manual aplicado a los 21 pesos de `PESOS_BASE`.
//
// Tres cosas se probaron y se descartaron por medirlas, y conviene no repetirlas:
//
//   1. Aptitud contra el campeón vigente a secas. La población se deteriora:
//      ganar a un campeón malo no te hace bueno y la referencia se mueve con
//      la población. De ahí el salón de la fama, que da un trinquete.
//   2. Quedarse con el mejor de la generación. Con partidas tan ruidosas, el
//      mejor lo es a menudo por suerte. Promediar los mejores con pesos filtra
//      ese ruido mucho mejor que escoger uno.
//   3. Recompensa solo por victoria. Dos configuraciones al azar NO terminan
//      la partida: ocho tablas de ocho, todas al tope de turnos. Sin `puntuacionA`
//      la fase de arranque a ciegas no tiene gradiente ninguno.
//
// Qué es y qué no es "sin ayuda humana". Los genes arrancan al azar: ningún
// valor de partida sale de la heurística escrita a mano. Lo que sí es humano es
// el CATÁLOGO DE RASGOS —qué términos existen en la puntuación— y la ESCALA de
// cada peso, que dice en qué unidades se mueve, no qué valor es bueno. Aprender
// también los rasgos es justo lo que hace la fase de red neuronal.
//
// `coronar` no se entrena. Llevar la bandera a la torre no es una preferencia
// que convenga graduar: es ganar la partida. Dejarlo suelto solo abre la puerta
// a que una generación aprenda a no ganar.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PESOS_BASE } from "../src/motor/bot.js";
import { configuracion, generador } from "./arena.mjs";
import { CORONAR, ESCALAS, GENES, pesosDesdeGenes, genesDesdePesos } from "./genoma.mjs";
import { crearPiscina, trocear, sumar, NUCLEOS } from "./paralelo.mjs";
import { escribirInforme } from "./informe.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

function normal(azar) {
  // Box-Muller. Dos uniformes dentro dan una normal fuera.
  let u = 0;
  let v = 0;
  while (u === 0) u = azar();
  while (v === 0) v = azar();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function genesAlAzar(azar) {
  return GENES.map(() => normal(azar) * 0.8);
}

function mutar(genes, sigma, azar) {
  return genes.map((g) => g + normal(azar) * sigma);
}

const comoConfig = (genes, nombre) => configuracion({ pesos: pesosDesdeGenes(genes), nombre });

function opciones(argv) {
  const o = {
    generaciones: 40,
    poblacion: 12,
    parejas: 8,
    semilla: 1,
    inicio: "aleatorio",
    paciencia: 12,
    limite: 400,
    salida: path.join(AQUI, "modelos"),
    nucleos: NUCLEOS,
  };
  for (let i = 2; i < argv.length; i += 2) {
    const clave = argv[i].replace(/^--/, "");
    const valor = argv[i + 1];
    if (!(clave in o)) throw new Error(`opción desconocida: ${argv[i]}`);
    o[clave] = ["inicio", "salida"].includes(clave) ? valor : Number(valor);
  }
  return o;
}

async function main() {
  const o = opciones(process.argv);
  const azar = generador(o.semilla);
  fs.mkdirSync(o.salida, { recursive: true });
  const piscina = crearPiscina(o.nucleos);

  console.log(`Entrenamiento de pesos por autojuego`);
  console.log(`  población ${o.poblacion} · generaciones ${o.generaciones} · ${o.parejas} emparejamientos por combate`);
  console.log(`  arranque: ${o.inicio} · semilla ${o.semilla} · ${piscina.nucleos} hilos · tope ${o.limite} turnos\n`);

  const semillaGenes = o.inicio === "base" ? genesDesdePesos({ ...PESOS_BASE }) : null;
  let media = semillaGenes || genesAlAzar(azar);

  const salon = [media];
  const MAX_SALON = 6;
  const PAREJAS_MEDIDA = 40;
  const SEMILLA_MEDIDA = 500000; // fija a propósito: si cambia, la curva es ruido
  const referencia = configuracion({ pesos: PESOS_BASE, nombre: "heurística a mano" });

  // Pesos de recombinación: decrecientes con el puesto, al estilo de CMA-ES.
  const mu = Math.max(2, Math.round(o.poblacion / 4));
  const crudos = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const sumaCrudos = crudos.reduce((a, b) => a + b, 0);
  const pesosRecomb = crudos.map((w) => w / sumaCrudos);

  const medir = async (genes) =>
    sumar(
      await piscina.ejecutar(
        trocear(comoConfig(genes, "media"), referencia, PAREJAS_MEDIDA, SEMILLA_MEDIDA, piscina.nucleos, o.limite)
      )
    );

  let sigma = 0.4;
  let mejorMarca = 0;
  let sinMejorar = 0;
  const historia = [];
  const arranque = Date.now();
  const rutaInforme = path.join(AQUI, "informe", "index.html");
  const titulo = `${o.inicio} · semilla ${o.semilla}`;
  // El informe se reescribe en cada generación: la idea es tenerlo abierto
  // mientras entrena y ver la curva crecer.
  const publicar = (enMarcha) =>
    escribirInforme(
      [{ titulo, creado: new Date().toISOString(), opciones: o, mejorPuntuacion: mejorMarca, pesos: pesosDesdeGenes(media), historia }],
      rutaInforme,
      { enMarcha }
    );

  for (let gen = 1; gen <= o.generaciones; gen++) {
    const descendencia = Array.from({ length: o.poblacion }, () => mutar(media, sigma, azar));

    const panel = [comoConfig(media, "media")];
    for (let k = 0; k < 2; k++) {
      panel.push(comoConfig(salon[Math.floor(azar() * salon.length)], `salón${k}`));
    }

    const tareas = [];
    descendencia.forEach((genes, i) => {
      const yo = comoConfig(genes, `ind${i}`);
      panel.forEach((rival, k) => {
        tareas.push({
          configA: yo,
          configB: rival,
          parejas: k === 0 ? o.parejas : Math.max(2, Math.round(o.parejas / 2)),
          semillaBase: gen * 1000 + 17 * k,
          limite: o.limite,
        });
      });
    });

    const resultados = await piscina.ejecutar(tareas);
    // Puntuación, no tasa de victorias: cuenta también las tablas repartidas.
    const aptitud = descendencia.map((_, i) => {
      const mios = resultados.slice(i * panel.length, (i + 1) * panel.length);
      let puntos = 0;
      let partidas = 0;
      for (const r of mios) {
        puntos += r.puntosA;
        partidas += r.partidas;
      }
      return partidas ? puntos / partidas : 0.5;
    });

    // Regla del quinto de éxito: sigma sube si muchos descendientes superan a
    // su padre y baja si casi ninguno lo hace. Se mira SOLO el combate contra
    // la media —la señal interna—, nunca la medición externa: esa es ruidosa y
    // hacía que sigma se desplomara aunque la búsqueda fuese bien.
    const exitos = descendencia.filter((_, i) => resultados[i * panel.length].puntuacionA > 0.5).length;
    const tasaExito = exitos / descendencia.length;

    const orden = descendencia
      .map((g, i) => ({ g, apt: aptitud[i] }))
      .sort((x, y) => y.apt - x.apt)
      .slice(0, mu);

    // La media se mueve hacia el promedio ponderado de los mejores.
    const nueva = media.map((_, j) => orden.reduce((s, o2, r) => s + pesosRecomb[r] * o2.g[j], 0));
    const paso = Math.hypot(...nueva.map((v, j) => v - media[j]));
    media = nueva;

    if (gen % 5 === 0) {
      salon.push(media);
      if (salon.length > MAX_SALON) salon.shift();
    }

    const contraBase = await medir(media);
    const tasa = contraBase.tasaA;
    const puntuacion = contraBase.puntuacionA;

    if (puntuacion > mejorMarca + 0.005) {
      mejorMarca = puntuacion;
      sinMejorar = 0;
    } else {
      sinMejorar++;
    }
    sigma = Math.max(0.08, Math.min(0.6, sigma * Math.exp((tasaExito - 0.2) * 0.6)));

    historia.push({
      generacion: gen,
      aptitudMejor: Number(orden[0].apt.toFixed(4)),
      aptitudMedia: Number((aptitud.reduce((a, b) => a + b, 0) / aptitud.length).toFixed(4)),
      contraBase: Number(tasa.toFixed(4)),
      puntuacionContraBase: Number(puntuacion.toFixed(4)),
      tablasContraBase: contraBase.tablas,
      sigma: Number(sigma.toFixed(4)),
      tasaExito: Number(tasaExito.toFixed(3)),
      paso: Number(paso.toFixed(4)),
      turnosMedia: contraBase.turnosMedia,
      segundos: Math.round((Date.now() - arranque) / 1000),
    });

    const barra = "#".repeat(Math.round(puntuacion * 40));
    console.log(
      `  gen ${String(gen).padStart(3)} · puntuación ${(puntuacion * 100).toFixed(0).padStart(3)}% ` +
        `(victorias ${(tasa * 100).toFixed(0)}%, tablas ${contraBase.tablas}) ${barra}` +
        (sinMejorar ? `  (${sinMejorar})` : "  <- mejor")
    );

    publicar(true);

    if (sinMejorar >= o.paciencia) {
      console.log(`\n  Estancado: ${o.paciencia} generaciones sin mejorar.`);
      break;
    }
  }

  await piscina.cerrar();
  publicar(false);

  const pesos = pesosDesdeGenes(media);
  const ultima = historia[historia.length - 1] || {};
  const resumen = {
    creado: new Date().toISOString(),
    opciones: o,
    generaciones: historia.length,
    mejorPuntuacion: mejorMarca,
    victoriasFinales: ultima.contraBase,
    pesos,
    historia,
  };
  const destino = path.join(o.salida, `pesos-${o.inicio}-s${o.semilla}.json`);
  fs.writeFileSync(destino, JSON.stringify(resumen, null, 2));
  console.log(`\n  Mejor puntuación contra la heurística a mano: ${(mejorMarca * 100).toFixed(0)}%`);
  console.log(`  Victorias en la última medición: ${((ultima.contraBase || 0) * 100).toFixed(0)}%`);
  console.log(`  Guardado en ${path.relative(process.cwd(), destino)}`);
  console.log(`  Informe en ${path.relative(process.cwd(), rutaInforme)}`);
}

// Solo entrena si se le invoca directamente. Importarlo no debe hacer nada:
// el informe necesita leer de aquí y no puede arrancar una tanda de partidas.
if (process.argv[1] && process.argv[1].endsWith("entrenar-pesos.mjs")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
