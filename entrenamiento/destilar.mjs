// Destilar la heurística en la red de jugada.
//
// LA IDEA. Hoy la heurística hace dos cosas: puntúa y CRIBA. La red solo ordena
// las cuatro candidatas que le pasa, así que nunca ve las otras veinticuatro. Si
// se quiere que la red decida sola, tiene que aprender a puntuarlas todas — y la
// forma rápida no es esperar a que lo reinvente jugando millones de partidas,
// sino enseñarle directamente el orden que la heurística ya sabe.
//
// Eso son ejemplos POR PARES: "esta jugada va antes que esta otra". No hace
// falta jugar ninguna partida para generarlos, así que es barato.
//
// SE MEZCLAN DOS PÉRDIDAS, Y NO ES OPCIONAL. La de pares solo mira diferencias,
// así que dispara la escala de la salida: entrenando solo con ella los logits se
// van a cientos y la red deja de valer como estimación de victoria, que es para
// lo que se usa en el resto del sistema. Los ejemplos de valor —posición y
// resultado de la partida— la mantienen calibrada.
//
//   node entrenamiento/destilar.mjs --partidas 400 --epocas 40

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES } from "../src/motor/tablero.js";
import { EQUIPOS, nuevaPartida, aplicar, movimientosLegales, reclutar, recogerLaBandera, renunciarARecoger } from "../src/motor/motor.js";
import { accionDeBot, puntuarAcciones, decisionDeRecogida, despliegueAleatorio, DISTANCIA } from "../src/motor/bot.js";
import { analizarTurno } from "../src/motor/analisis.js";
import { rasgosDeJugada, contextoDeTurno, TAMANO, FIRMA } from "../src/motor/rasgos-jugada.js";
import { crearRed, entrenarLote, entrenarPares, evaluar, aObjeto, desdeObjeto, ACTIVACION } from "./red.mjs";
import { generador, repartoDeTablas } from "./arena.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const [EQUIPO_A] = EQUIPOS;

function opciones(argv) {
  const o = {
    partidas: 400, semilla: 1, epocas: 40, lote: 32, tasa: 0.004, decaimiento: 0.001,
    oculta: 28, limite: 400, muestreo: 6, paresPorPosicion: 6, paresSueltos: 14, margen: 0, pesoPares: 1,
  };
  for (let i = 2; i < argv.length; i += 2) {
    const clave = argv[i].replace(/^--/, "");
    if (!(clave in o)) throw new Error(`opción desconocida: ${argv[i]}`);
    o[clave] = Number(argv[i + 1]);
  }
  return o;
}

const o = opciones(process.argv);
const azar = generador(o.semilla);

console.log("Destilar la heurística en la red de jugada\n");
console.log(`  ${o.partidas} partidas · una posición de cada ${o.muestreo} turnos`);
console.log(`  hasta ${o.paresPorPosicion} pares por posición, con margen mínimo de ${o.margen} puntos\n`);

// --- Recoger posiciones, pares y valores --------------------------------------

const pares = [];
const valores = [];
let posiciones = 0;
let descartadosPorMargen = 0;

const t0 = Date.now();
for (let p = 0; p < o.partidas; p++) {
  const az = generador(o.semilla + p * 7919);
  const despliegues = {};
  for (const c of COLORES) despliegues[c] = despliegueAleatorio(c, az);
  let e = nuevaPartida(despliegues, { primero: COLORES[Math.floor(az() * 4)] });
  const muestras = [];
  let t = 0;

  while (!e.fin && t < o.limite) {
    if (e.pendiente) {
      const q = e.pendiente;
      e = q.tipo === "recoger" ? (decisionDeRecogida(e, q.color) ? recogerLaBandera(e) : renunciarARecoger(e)) : reclutar(e, Math.max(...q.opciones));
      continue;
    }
    const color = e.turno;
    if (t % o.muestreo === 0) {
      const puntuadas = puntuarAcciones(e, color, { azar: az });
      if (puntuadas.length >= 2) {
        posiciones++;
        const contexto = contextoDeTurno(e, color, analizarTurno(e, color, DISTANCIA));
        const rasgos = puntuadas.map((x) => ({ nota: x.nota, entrada: rasgosDeJugada(e, color, x.accion, contexto) }));
        // PARES ANCLADOS EN LA MEJOR, y esto es lo que costó descubrir. La
        // primera versión sorteaba dos jugadas cualesquiera y descartaba las que
        // la heurística puntuaba parecido, por no aprender su ruido de
        // desempate. Resultado: 98,5% de pares acertados y solo 57% de acierto
        // en LA JUGADA QUE SE ELIGE, que es lo único que se juega. Y jugando
        // sola sacaba 34%, por debajo de la propia heurística.
        //
        // La razón es que elegir la mejor de veintiocho se decide en las parejas
        // AJUSTADAS —la primera contra la segunda— y eran justo las que el
        // margen tiraba a la basura. Así que ahora la mejor se enfrenta a las
        // demás, empezando por su rival más cercana, sin filtro de margen.
        const cuantas = Math.min(o.paresPorPosicion, rasgos.length - 1);
        for (let k = 1; k <= cuantas; k++) {
          // La segunda pesa más: es la que decide de verdad.
          const peso = o.pesoPares * (k === 1 ? 3 : 1);
          pares.push({ mejor: rasgos[0].entrada, peor: rasgos[k].entrada, peso });
        }
        // Y EL ORDEN ENTERO, no solo quién va primero. Entrenando casi solo con
        // "el mejor contra los demás" la red reconocía al primero pero perdía la
        // ordenación del resto: el puesto medio de lo que elegía se fue de 1,7 a
        // 7,5, o sea que cuando fallaba, fallaba mucho. Hacen falta las dos
        // cosas, así que aquí van pares por TODA la lista y sin filtro de
        // margen: si dos jugadas están casi empatadas, da igual cuál elija, y
        // ese par simplemente empuja poco.
        for (let k = 0; k < o.paresSueltos; k++) {
          const i = Math.floor(az() * rasgos.length);
          const j = Math.floor(az() * rasgos.length);
          if (i === j) continue;
          const [alto, bajo] = rasgos[i].nota > rasgos[j].nota ? [rasgos[i], rasgos[j]] : [rasgos[j], rasgos[i]];
          pares.push({ mejor: alto.entrada, peor: bajo.entrada, peso: o.pesoPares });
        }
        // Y la jugada que se acaba jugando, para el valor.
        muestras.push({ entrada: rasgos[0].entrada, color });
      }
    }
    const a = accionDeBot(e, color, { azar: az });
    if (!a) break;
    e = aplicar(e, a);
    t++;
  }

  const fin = e.fin;
  const valorA = fin && fin.ganador ? (EQUIPO_A.includes(fin.ganador) ? 1 : 0) : repartoDeTablas(e);
  for (const m of muestras) {
    valores.push({ entrada: m.entrada, objetivo: EQUIPO_A.includes(m.color) ? valorA : 1 - valorA });
  }
  if ((p + 1) % 100 === 0) console.log(`  ...${p + 1}/${o.partidas} partidas · ${pares.length} pares`);
}

console.log(`\n  ${posiciones} posiciones · ${pares.length} pares · ${valores.length} valores · ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`  pares descartados por margen escaso: ${descartadosPorMargen}\n`);

// --- Entrenar con las dos pérdidas --------------------------------------------

const baraja = (lista) => {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
};
baraja(pares); baraja(valores);
const cortePares = Math.floor(pares.length * 0.85);
const paresEnt = pares.slice(0, cortePares);
const paresVal = pares.slice(cortePares);

const red = crearRed([TAMANO, o.oculta, 1], azar);
const aciertoEn = (conjunto) => {
  let ok = 0;
  for (const par of conjunto) if (evaluar(red, par.mejor) >= evaluar(red, par.peor)) ok++;
  return ok / (conjunto.length || 1);
};

console.log("  época   orden(validación)   escala de la salida");
let mejorAcierto = 0;
let mejorPesos = aObjeto(red);
for (let epoca = 1; epoca <= o.epocas; epoca++) {
  for (let i = 0; i < paresEnt.length; i += o.lote) {
    entrenarPares(red, paresEnt.slice(i, i + o.lote), { tasa: o.tasa, decaimiento: o.decaimiento });
    // Un lote de valor por cada lote de pares: es lo que impide que la salida se
    // dispare y deje de ser una probabilidad.
    const j = (i * 3) % Math.max(1, valores.length - o.lote);
    entrenarLote(red, valores.slice(j, j + o.lote), { tasa: o.tasa, decaimiento: o.decaimiento });
  }
  if (epoca % 5 === 0 || epoca === o.epocas) {
    const acierto = aciertoEn(paresVal);
    const media = valores.slice(0, 200).reduce((s, v) => s + evaluar(red, v.entrada), 0) / 200;
    console.log(`  ${String(epoca).padStart(5)}   ${(acierto * 100).toFixed(1)}%              media de salida ${media.toFixed(3)}`);
    if (acierto > mejorAcierto) { mejorAcierto = acierto; mejorPesos = aObjeto(red); }
  }
}

const salida = path.join(AQUI, "modelos", "red-jugada-destilada.json");
fs.mkdirSync(path.dirname(salida), { recursive: true });
fs.writeFileSync(salida, JSON.stringify({
  firmaRasgos: FIRMA, activacion: ACTIVACION, creado: new Date().toISOString(), origen: "destilación", opciones: o,
  ordenAcertado: mejorAcierto, red: mejorPesos,
}, null, 2));
console.log(`\n  Mejor orden reproducido: ${(mejorAcierto * 100).toFixed(1)}% de los pares`);
console.log(`  Guardado en ${path.relative(process.cwd(), salida)}`);
