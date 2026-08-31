// Coevolución: las dos redes juegan entre ellas y aprenden de esas partidas.
//
// Hasta aquí cada red se entrenaba con partidas jugadas por la heurística, así
// que aprendía a predecir el resultado de un juego que no era el suyo. Con eso
// se llega al nivel del maestro y poco más. Aquí las partidas las juegan las
// propias redes: la de despliegue monta la posición y la de jugada decide cada
// movimiento, y de ahí salen los ejemplos con los que ambas se reentrenan.
//
// LAS TRES COSAS QUE HAY QUE HACER BIEN, aprendidas rompiéndolas:
//
// 1. NO ENTRENAR DESDE CERO CADA RONDA. El primer intento rehacía las redes con
//    las 300 partidas de la ronda, cuando venían de 4000. Las cinco rondas
//    salieron peores y parecía que la coevolución no servía; lo que medía era el
//    tamaño del conjunto de datos. Ahora se continúa desde los pesos vigentes y
//    se guarda la mejor validación incluyendo el punto de partida, así que la
//    ronda solo puede mantener o mejorar.
//
// 2. NO JUGAR SOLO CONTRA UNO MISMO. Aquel intento hacía desplegar a los cuatro
//    colores con la red, así que los ejemplos solo contenían posiciones que la
//    red ya prefería. El panel son aperturas humanas: dejaba de verlas y las
//    olvidaba. `humana-02` se desplomó al 0%, no por ser imbatible sino por
//    haberse vuelto desconocida. Ahora una parte de las partidas son de liga,
//    contra la mezcla de aperturas y la heurística.
//
// 3. NO REPETIR PARTIDA. Sin ruido, dos redes que ya se parecen generan siempre
//    lo mismo. Las jugadas llevan exploración y los despliegues, recocido.
//
// Y la vara no se mueve: cada ronda se mide contra el panel, que no cambia, y
// solo se adopta si sube. Las redes juegan entre ellas pero se puntúan contra
// algo externo, así que "mejorar" no puede degenerar en "cambiar".
//
//   node entrenamiento/coevolucion.mjs --rondas 6 --partidas 400

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLORES } from "../src/motor/tablero.js";
import {
  EQUIPOS, nuevaPartida, aplicar, reclutar, recogerLaBandera, renunciarARecoger,
} from "../src/motor/motor.js";
import {
  accionDeBot, puntuarAcciones, decisionDeRecogida, despliegueAleatorio, DISTANCIA,
} from "../src/motor/bot.js";
import { analizarTurno } from "../src/motor/analisis.js";
import { generador, repartoDeTablas } from "./arena.mjs";
import { rasgosDeDespliegue, TAMANO as TAMANO_DESPLIEGUE, FIRMA as FIRMA_DESPLIEGUE } from "../src/motor/rasgos-despliegue.js";
import { rasgosDeJugada, contextoDeTurno, TAMANO as TAMANO_JUGADA, FIRMA as FIRMA_JUGADA } from "../src/motor/rasgos-jugada.js";
import { crearRed, entrenarLote, entrenarPares, evaluar, aObjeto, desdeObjeto } from "./red.mjs";
import { construirPanel, medirContraPanel, cargarAperturas } from "./panel.mjs";
import { fuenteDeDespliegues, aColocacion, aTexto } from "./aperturas.mjs";
import { poblacionInicial, siguienteGeneracion, actualizarArchivo } from "./formaciones.mjs";
import { despliegueGuiado } from "./entrenar-despliegue.mjs";
import { accionConRed } from "./entrenar-jugada.mjs";
import { jugadaSoloRed } from "../src/motor/bot-red.js";
import { movimientosLegales } from "../src/motor/motor.js";
import { generarInforme } from "./informe-redes.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MODELOS = path.join(AQUI, "modelos");
const [EQUIPO_A, EQUIPO_B] = EQUIPOS;

function opciones(argv) {
  const o = {
    rondas: 6, partidas: 400, epocas: 60, lote: 64, decaimiento: 0.001,
    ocultaDespliegue: 16, ocultaJugada: 28, semilla: 1, limite: 400,
    candidatas: 12, candidatos: 30, escalada: 200, parejasPanel: 6,
    // Recocido a lo largo de las rondas. Al principio la exploración es lo que
    // impide que las dos redes jueguen siempre la misma partida; al final, con
    // las redes ya buenas, ese mismo 22% es ruido metido en los datos: una de
    // cada cinco jugadas elegida a voleo entre las candidatas. Así que se
    // enfría. Pero NO hasta cero: las formaciones siguen evolucionando, o sea
    // que el entorno no deja de moverse, y una red que deja de explorar deja de
    // encontrar respuestas a lo que aparece nuevo.
    exploracion: 0.25, exploracionFinal: 0.08,
    tasa: 0.003, tasaFinal: 0.0008,
    // Cuántas rondas de ejemplos se conservan. Con una sola, cada ronda ve muy
    // poco y el ajuste va dando bandazos.
    memoria: 3,
    // Fracción de partidas de liga: el otro equipo sale de la población de
    // formaciones y juega con la heurística, para no perder de vista al mundo.
    liga: 0.5,
    // La población de formaciones que evoluciona contra las redes. Su aptitud
    // sale de las propias partidas de liga, así que no cuesta partidas aparte.
    poblacion: 30, elite: 0.25, sangreNueva: 0.15, mutacion: 0.4,
    // En seco no se escriben modelos ni formaciones: para probar el bucle sin
    // que un ensayo de 50 partidas pise a un modelo de 4000.
    seco: 0,
    // SIN HEURÍSTICA DELANTE. Con esto la red puntúa TODAS las jugadas legales
    // en vez de reordenar las cuatro que le pasa la heurística. Sale más barato
    // -0,59 ms por turno frente a 0,87- pero exige una red destilada: la
    // publicada, obligada a puntuarlas todas, saca 0 victorias de 72, porque
    // nunca ha visto más que las finalistas.
    soloRed: 0,
    // El ancla: cada ronda se siguen metiendo pares de la heurística para que la
    // red no olvide el orden que aprendió al destilar mientras persigue
    // resultados. La heurística deja el camino de decisión pero se queda de
    // andamio, que es distinto. Se puede bajar a cero para soltarla del todo.
    anclaPares: 1, paresPorPosicion: 6, paresSueltos: 14, muestreoPares: 8,
    // Desplazamiento de las semillas del veredicto. Lo usa el proceso nocturno
    // para que cada sesión se mida en partidas distintas: si todas las sesiones
    // se midieran en las mismas, elegir la mejor sesión de la noche volvería a
    // ser el sesgo del máximo, que es el error que ya costó doce rondas.
    veredictoBase: 0,
    // Cuántos errores estándar tiene que sacarle una ronda a la mejor marca
    // para adoptarla. Sin margen se adopta ruido: en una prueba con un solo
    // emparejamiento subió del 53% al 61% con +-6 de error en cada medida, y
    // eso no es una mejora, es la misma red medida dos veces.
    margen: 1,
  };
  for (let i = 2; i < argv.length; i += 2) {
    const clave = argv[i].replace(/^--/, "");
    if (!(clave in o)) throw new Error(`opción desconocida: ${argv[i]}`);
    o[clave] = Number(argv[i + 1]);
  }
  return o;
}

const resolverPendiente = (estado) => {
  const p = estado.pendiente;
  return p.tipo === "recoger"
    ? decisionDeRecogida(estado, p.color) ? recogerLaBandera(estado) : renunciarARecoger(estado)
    : reclutar(estado, Math.max(...p.opciones));
};

function leer(nombre) {
  const f = path.join(MODELOS, nombre);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

// --- Una tanda de partidas ----------------------------------------------------

function jugarTanda(redD, redJ, o, semillaBase, sacarDespliegue, liga) {
  const deDespliegue = [];
  const deJugada = [];
  const pares = [];
  let decididas = 0;
  let deLiga = 0;

  for (let i = 0; i < o.partidas; i++) {
    const azar = generador(semillaBase + i * 7919);
    // En las partidas de liga las redes ocupan un equipo y la mezcla el otro. Se
    // alterna el lado, porque el tablero no es simétrico y si las redes jugaran
    // siempre de A la red de despliegue aprendería el sesgo del lado.
    const esLiga = azar() < o.liga;
    const ladoRed = i % 2 === 0 ? EQUIPO_A : EQUIPO_B;
    const conRed = (color) => !esLiga || ladoRed.includes(color);
    // Turno rotatorio, no sorteo: así todas las formaciones juegan el mismo
    // número de partidas y sus aptitudes son comparables entre sí.
    const formacion = esLiga && liga && liga.length ? liga[deLiga % liga.length] : null;
    if (esLiga) deLiga++;

    const despliegues = {};
    const rasgosPorColor = {};
    for (const color of COLORES) {
      const colocacion = conRed(color)
        ? redD ? despliegueGuiado(color, azar, redD, o.candidatos, o.escalada) : despliegueAleatorio(color, azar)
        : formacion ? aColocacion(formacion.rejilla, color)
        : sacarDespliegue(color, azar).colocacion;
      despliegues[color] = colocacion;
      rasgosPorColor[color] = rasgosDeDespliegue(color, colocacion);
    }

    let estado = nuevaPartida(despliegues, { primero: COLORES[Math.floor(azar() * 4)] });
    const muestras = [];
    let turnos = 0;
    while (!estado.fin && turnos < o.limite) {
      if (estado.pendiente) {
        estado = resolverPendiente(estado);
        continue;
      }
      const color = estado.turno;
      const puntuadas = puntuarAcciones(estado, color, { azar });
      if (!puntuadas.length) break;
      const finalistas = puntuadas.slice(0, Math.min(o.candidatas, puntuadas.length));
      const contexto = contextoDeTurno(estado, color, analizarTurno(estado, color, DISTANCIA));

      // Pares de la heurística para el ancla, en posiciones sorteadas. Cuestan
      // una puntuación completa (0,42 ms), así que no en todos los turnos.
      if (o.anclaPares && conRed(color) && turnos % o.muestreoPares === 0 && puntuadas.length >= 3) {
        const rasgos = puntuadas.map((x) => rasgosDeJugada(estado, color, x.accion, contexto));
        for (let k = 1; k <= Math.min(o.paresPorPosicion, rasgos.length - 1); k++) {
          pares.push({ mejor: rasgos[0], peor: rasgos[k], peso: k === 1 ? 3 : 1 });
        }
        for (let k = 0; k < o.paresSueltos; k++) {
          const i = Math.floor(azar() * rasgos.length);
          const j = Math.floor(azar() * rasgos.length);
          if (i === j) continue;
          const [a, b] = i < j ? [i, j] : [j, i];
          pares.push({ mejor: rasgos[a], peor: rasgos[b], peso: 1 });
        }
      }

      let elegida;
      if (!conRed(color)) {
        elegida = finalistas[0].accion; // el rival de liga juega la heurística
      } else if (o.soloRed && redJ) {
        // La red decide sobre TODAS las legales. La exploración sale de sus
        // propias candidatas, no de las de la heurística: si explorara entre las
        // de la heurística, seguiría atada a su criterio.
        elegida = jugadaSoloRed(estado, color, redJ, { azar, ruido: o.exploracion });
      } else if (azar() < o.exploracion) {
        elegida = finalistas[Math.floor(azar() * finalistas.length)].accion;
      } else if (redJ) {
        let mejorValor = -Infinity;
        elegida = finalistas[0].accion;
        for (const { accion } of finalistas) {
          const valor = evaluar(redJ, rasgosDeJugada(estado, color, accion, contexto));
          if (valor > mejorValor) { mejorValor = valor; elegida = accion; }
        }
      } else {
        elegida = finalistas[0].accion;
      }
      // Las jugadas del rival de liga también son ejemplos válidos: el objetivo
      // es el resultado de la partida, y da igual quién eligiera el movimiento.
      muestras.push({ entrada: rasgosDeJugada(estado, color, elegida, contexto), color });
      estado = aplicar(estado, elegida);
      turnos++;
    }

    const fin = estado.fin;
    let valorA;
    if (fin && fin.ganador) {
      valorA = EQUIPO_A.includes(fin.ganador) ? 1 : 0;
      decididas++;
    } else {
      valorA = repartoDeTablas(estado);
    }
    const suyo = (color) => (EQUIPO_A.includes(color) ? valorA : 1 - valorA);
    // La aptitud de la formación es lo que le saca a las redes. Las tablas
    // cuentan en fracción, que es más información que tirarlas.
    if (formacion) {
      formacion.gana += ladoRed === EQUIPO_A ? 1 - valorA : valorA;
      formacion.juega += 1;
    }
    for (const color of COLORES) deDespliegue.push({ entrada: rasgosPorColor[color], objetivo: suyo(color) });
    for (const m of muestras) deJugada.push({ entrada: m.entrada, objetivo: suyo(m.color) });
  }
  return { deDespliegue, deJugada, pares, decididas, deLiga };
}

// --- Continuar el entrenamiento de una red ------------------------------------

// `previa` es la red vigente. Se sigue desde sus pesos, no desde cero, y el
// punto de partida entra como candidato en la parada temprana: si ninguna época
// mejora su validación, la ronda devuelve la red tal cual estaba.
function entrenar(ejemplos, tamano, oculta, o, azar, previa, pares = null) {
  const barajado = ejemplos.slice();
  for (let i = barajado.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [barajado[i], barajado[j]] = [barajado[j], barajado[i]];
  }
  const corte = Math.floor(barajado.length * 0.75);
  const entrenamiento = barajado.slice(0, corte);
  const validacion = barajado.slice(corte);

  const perdidaDe = (red, conjunto) => {
    let s = 0;
    for (const ej of conjunto) {
      const p = evaluar(red, ej.entrada);
      s += -(ej.objetivo * Math.log(p + 1e-9) + (1 - ej.objetivo) * Math.log(1 - p + 1e-9));
    }
    return s / (conjunto.length || 1);
  };

  const red = previa ? desdeObjeto(aObjeto(previa)) : crearRed([tamano, oculta, 1], azar);
  let mejor = previa ? perdidaDe(red, validacion) : Infinity;
  let mejorPesos = aObjeto(red);
  const partida = previa ? mejor : null;
  const curva = [];
  let epocasUtiles = 0;
  for (let epoca = 1; epoca <= o.epocas; epoca++) {
    for (let i = 0; i < entrenamiento.length; i += o.lote) {
      entrenarLote(red, entrenamiento.slice(i, i + o.lote), { tasa: o.tasa, decaimiento: o.decaimiento });
      // El ancla, intercalada: un lote de orden por cada lote de valor. Sin
      // esto la red persigue el resultado y olvida el orden destilado; sin los
      // de valor, la salida se dispara y deja de ser una probabilidad.
      if (pares && pares.length) {
        const j = (i * 2) % Math.max(1, pares.length - o.lote);
        entrenarPares(red, pares.slice(j, j + o.lote), { tasa: o.tasa, decaimiento: o.decaimiento });
      }
    }
    if (epoca % 5 === 0 || epoca === o.epocas) {
      const pEnt = perdidaDe(red, entrenamiento);
      const pVal = perdidaDe(red, validacion);
      curva.push({ epoca, entrenamiento: Number(pEnt.toFixed(5)), validacion: Number(pVal.toFixed(5)) });
      if (pVal < mejor) { mejor = pVal; mejorPesos = aObjeto(red); epocasUtiles = epoca; }
    }
  }
  const buena = desdeObjeto(mejorPesos);
  const cubos = Array.from({ length: 10 }, () => ({ n: 0, suma: 0, real: 0 }));
  let aciertos = 0;
  for (const ej of validacion) {
    const p = evaluar(buena, ej.entrada);
    const c = cubos[Math.min(9, Math.floor(p * 10))];
    c.n++; c.suma += p; c.real += ej.objetivo;
    if ((p > 0.5 ? 1 : 0) === (ej.objetivo > 0.5 ? 1 : 0)) aciertos++;
  }
  return {
    red: buena,
    pesos: mejorPesos,
    perdida: mejor,
    perdidaDePartida: partida,
    epocasUtiles,
    acierto: aciertos / (validacion.length || 1),
    calibracion: cubos.filter((c) => c.n).map((c) => ({ n: c.n, predicho: c.suma / c.n, real: c.real / c.n })),
    curva,
  };
}

// --- Principal ------------------------------------------------------------------

async function main() {
  const o = opciones(process.argv);
  const azar = generador(o.semilla);
  const panel = construirPanel({ azar: generador(2024) }); // panel fijo, no depende de la ronda
  const sacarDespliegue = fuenteDeDespliegues(cargarAperturas(), despliegueAleatorio);

  const guardadoD = leer("red-despliegue.json");
  const guardadoJ = leer("red-jugada.json");
  // Si los rasgos han cambiado de número, el modelo guardado ya no encaja.
  // Cargarlo daría basura sin dar ningún error.
  const sirve = (g, tamano, firma) => g && g.red && g.red.capas[0] === tamano && g.firmaRasgos === firma;
  let redD = sirve(guardadoD, TAMANO_DESPLIEGUE, FIRMA_DESPLIEGUE) ? desdeObjeto(guardadoD.red) : null;
  let redJ = sirve(guardadoJ, TAMANO_JUGADA, FIRMA_JUGADA) ? desdeObjeto(guardadoJ.red) : null;
  // Sin heurística delante hace falta una red que sepa puntuarlo todo, y esa es
  // la destilada. La publicada saca 0 victorias de 72 en ese papel.
  if (o.soloRed) {
    const destilada = leer("red-jugada-destilada.json");
    if (sirve(destilada, TAMANO_JUGADA, FIRMA_JUGADA)) {
      redJ = desdeObjeto(destilada.red);
      console.log("  arranque de jugada: la red DESTILADA (decide sobre todas las jugadas)");
    } else {
      console.log("  ! sin red destilada válida: node entrenamiento/destilar.mjs");
    }
  }

  console.log("Coevolución: las dos redes juegan entre ellas\n");
  console.log(`  ${o.rondas} rondas · ${o.partidas} partidas por ronda · panel de ${panel.length} rivales`);
  console.log(`  arranque: despliegue ${redD ? "modelo guardado" : "desde cero"} · jugada ${redJ ? "modelo guardado" : "desde cero"}`);
  console.log(`  ${Math.round(o.liga * 100)}% de partidas de liga · memoria de ${o.memoria} rondas de ejemplos`);
  console.log(`  población de ${o.poblacion} formaciones que evoluciona contra las redes`);
  console.log(`  exploración ${o.exploracion} -> ${o.exploracionFinal} · tasa ${o.tasa} -> ${o.tasaFinal}\n`);

  const historia = [];
  const arranque = Date.now();

  // OJO CON ESTO, que costó doce rondas tiradas. `medirContraPanel` es
  // determinista: con la misma semilla juega exactamente las mismas partidas. Si
  // el titular conserva la nota con la que fue elegido, compite con una nota
  // inflada -fue elegido justamente por haber tenido suerte en esas partidas-
  // mientras los aspirantes traen notas honestas. El listón se vuelve
  // inalcanzable por construcción: doce rondas seguidas descartadas contra un
  // 86% que salía de un 84% que remedido en semillas frescas era 73%.
  //
  // Así que cada ronda se remide también al titular, en las MISMAS partidas que
  // al aspirante. La comparación queda emparejada y el titular tiene que
  // revalidar su puesto en vez de heredarlo.
  const medir = (rd, rj, semillaBase = 31337) => {
    const aspirante = {
      desplegar: (color, az) => (rd ? despliegueGuiado(color, az, rd, o.candidatos, o.escalada) : despliegueAleatorio(color, az)),
      jugar: (estado, color, az) =>
        !rj ? accionDeBot(estado, color, { azar: az })
        : o.soloRed ? jugadaSoloRed(estado, color, rj, { azar: az })
        : accionConRed(estado, color, rj, { candidatas: o.candidatas, azar: az }),
    };
    return medirContraPanel(aspirante, panel, { parejas: o.parejasPanel, semillaBase });
  };

  const partida = medir(redD, redJ);
  console.log(`  Punto de partida contra el panel: ${(partida.tasa * 100).toFixed(0)}% ±${Math.round(partida.error * 100)} (semilla de referencia)\n`);
  historia.push({ ronda: 0, panel: partida.tasa, error: partida.error, segundos: Math.round((Date.now() - arranque) / 1000) });
  await publicar(historia, o);

  // Depósito de ejemplos: las últimas `memoria` rondas. Entrenar solo con la
  // ronda recién jugada da muy pocos datos y el ajuste va a bandazos.
  const deposito = [];

  // La población de formaciones. Evoluciona en paralelo a las redes: cada ronda
  // las que mejor les ganan se cruzan entre ellas. El PANEL no se toca — es la
  // vara y tiene que seguir siendo el mismo para que la curva signifique algo.
  let poblacion = poblacionInicial(o.poblacion, cargarAperturas(), azar);
  const archivo = new Map();

  // Interpolación lineal de la ronda 1 a la última.
  const enfriar = (desde, hasta, ronda) =>
    o.rondas <= 1 ? hasta : desde + (hasta - desde) * ((ronda - 1) / (o.rondas - 1));

  for (let ronda = 1; ronda <= o.rondas; ronda++) {
    const t0 = Date.now();
    const oRonda = {
      ...o,
      exploracion: enfriar(o.exploracion, o.exploracionFinal, ronda),
      tasa: enfriar(o.tasa, o.tasaFinal, ronda),
    };
    const tanda = jugarTanda(redD, redJ, oRonda, o.semilla + ronda * 104729, sacarDespliegue, poblacion);
    deposito.push(tanda);
    while (deposito.length > o.memoria) deposito.shift();
    const todosD = deposito.flatMap((t) => t.deDespliegue);
    const todosJ = deposito.flatMap((t) => t.deJugada);

    const nuevaD = entrenar(todosD, TAMANO_DESPLIEGUE, o.ocultaDespliegue, oRonda, azar, redD);
    const todosPares = deposito.flatMap((t) => t.pares || []);
    const nuevaJ = entrenar(todosJ, TAMANO_JUGADA, o.ocultaJugada, oRonda, azar, redJ, o.anclaPares ? todosPares : null);
    // Partidas nuevas cada ronda, y el titular las juega también.
    const semillaMedida = 31337 + ronda * 15485863;
    const medida = medir(nuevaD.red, nuevaJ.red, semillaMedida);
    const titular = medir(redD, redJ, semillaMedida);

    // Las formaciones se reproducen con la aptitud que acaban de sacar contra
    // las redes de ESTA ronda, antes de decidir si las redes se adoptan.
    const generacion = siguienteGeneracion(poblacion, cargarAperturas(), o, azar);
    actualizarArchivo(archivo, generacion.ordenada, ronda);
    const dura = generacion.ordenada[0];
    poblacion = generacion.poblacion;

    // Solo se adoptan si mejoran contra la vara externa, y por encima del
    // ruido. Sin la primera condición la coevolución deriva: las redes se
    // adaptan la una a la otra y se alejan de jugar bien contra cualquier otra
    // cosa. Sin la segunda se adopta ruido, que es igual de malo porque cada
    // adopción mueve el punto de partida de la siguiente ronda.
    const listón = titular.tasa + o.margen * medida.error;
    const mejora = medida.tasa > listón;
    if (mejora) { redD = nuevaD.red; redJ = nuevaJ.red; }

    console.log(
      `  ronda ${ronda}  ${todosJ.length} jugadas (${tanda.deLiga}/${o.partidas} de liga, expl ${oRonda.exploracion.toFixed(2)}) · decididas ${tanda.decididas} · ` +
        `panel ${(medida.tasa * 100).toFixed(0)}% vs titular ${(titular.tasa * 100).toFixed(0)}% ±${Math.round(medida.error * 100)} · ` +
        `peor ${medida.peor.rival} (${(medida.peor.tasa * 100).toFixed(0)}%)` +
        (mejora ? "  <- adoptadas" : `  (descartadas, hacía falta ${(listón * 100).toFixed(0)}%)`) +
        `  ${Math.round((Date.now() - t0) / 1000)}s`
    );
    console.log(
      `           formación más dura: ${dura.origen} le saca ${(dura.aptitud * 100).toFixed(0)}% ` +
        `en ${dura.juega} partidas · archivo de ${archivo.size}`
    );

    historia.push({
      ronda, panel: mejora ? medida.tasa : titular.tasa,
      medida: medida.tasa, titular: titular.tasa, error: medida.error, adoptadas: mejora,
      ejemplosDespliegue: todosD.length, ejemplosJugada: todosJ.length,
      decididas: tanda.decididas, deLiga: tanda.deLiga,
      exploracion: oRonda.exploracion, tasa: oRonda.tasa,
      formaciones: {
        masDura: { origen: dura.origen, aptitud: dura.aptitud, juega: dura.juega },
        media: generacion.ordenada.reduce((s, f) => s + f.aptitud, 0) / generacion.ordenada.length,
        archivo: archivo.size,
      },
      despliegue: { perdida: nuevaD.perdida, perdidaDePartida: nuevaD.perdidaDePartida, epocasUtiles: nuevaD.epocasUtiles, acierto: nuevaD.acierto, calibracion: nuevaD.calibracion, curva: nuevaD.curva },
      jugada: { perdida: nuevaJ.perdida, perdidaDePartida: nuevaJ.perdidaDePartida, epocasUtiles: nuevaJ.epocasUtiles, acierto: nuevaJ.acierto, calibracion: nuevaJ.calibracion, curva: nuevaJ.curva },
      porRival: medida.porRival,
      segundos: Math.round((Date.now() - arranque) / 1000),
    });

    if (mejora && !o.seco) {
      guardar("red-despliegue.json", guardadoD, nuevaD, o, medida);
      guardar("red-jugada.json", guardadoJ, nuevaJ, o, medida);
    }
    await publicar(historia, o);
  }

  if (!o.seco) guardarDuras(archivo);

  // Veredicto final en semillas que no ha visto ninguna ronda. El máximo de las
  // medidas por ronda no vale como resumen: elegir el máximo de una tanda de
  // medidas ruidosas sesga al alza, que es exactamente cómo un 73% acabó
  // anunciado como 84%.
  console.log("\n  Veredicto en semillas frescas (ninguna ronda las ha usado):");
  const finales = [];
  for (const s of [77003, 91117, 20261]) {
    const r = medir(redD, redJ, s + o.veredictoBase);
    finales.push(r.tasa);
    console.log(`    semilla ${s}: ${(r.tasa * 100).toFixed(0)}% ±${Math.round(r.error * 100)} · peor ${r.peor.rival} (${(r.peor.tasa * 100).toFixed(0)}%)`);
  }
  const media = finales.reduce((a, b) => a + b, 0) / finales.length;
  console.log(`\n  Media: ${(media * 100).toFixed(1)}%  ${o.seco ? "(en seco: no se ha guardado nada)" : ""}`);
  console.log(`  Informe: docs/index.html`);
  historia.push({ ronda: "final", veredicto: media, semillas: finales });
  await publicar(historia, o);
}

// Las formaciones duras van a `aperturas/duras/`, NO a `aperturas/campeonas/`.
// Parece un detalle y no lo es: `campeonas` la carga `construirPanel`, así que
// escribir ahí endurecería la vara de medir y la curva bajaría sin que se
// pudiera distinguir "las redes empeoran" de "los rivales mejoran".
function guardarDuras(archivo) {
  const carpeta = path.join(AQUI, "aperturas", "duras");
  fs.mkdirSync(carpeta, { recursive: true });
  for (const f of fs.readdirSync(carpeta)) if (f.endsWith(".txt")) fs.unlinkSync(path.join(carpeta, f));
  const lista = [...archivo.values()].sort((a, b) => b.aptitud - a.aptitud).slice(0, 12);
  lista.forEach((f, i) => {
    const cabecera = [
      `# dura ${i + 1} · le saca ${(f.aptitud * 100).toFixed(0)}% a las redes en ${f.juega} partidas`,
      `# salida de: ${f.origen} · ronda ${f.ronda}`,
      `# NO forma parte del panel a propósito: el panel es la vara y no se mueve.`,
    ].join("\n");
    fs.writeFileSync(path.join(carpeta, `dura-${String(i + 1).padStart(2, "0")}.txt`), `${cabecera}\n${aTexto(f.rejilla)}\n`);
  });
  if (lista.length) console.log(`\n  ${lista.length} formaciones duras en entrenamiento/aperturas/duras/`);
}

function guardar(nombre, previo, entrenada, o, medida) {
  const destino = path.join(MODELOS, nombre);
  fs.writeFileSync(destino, JSON.stringify({
    ...(previo || {}),
    firmaRasgos: nombre.includes("despliegue") ? FIRMA_DESPLIEGUE : FIRMA_JUGADA,
    creado: new Date().toISOString(),
    origen: "coevolución",
    opciones: o,
    perdidaValidacion: entrenada.perdida,
    acierto: entrenada.acierto,
    victoriasEnJuego: medida.tasa,
    errorEnJuego: medida.error,
    calibracion: entrenada.calibracion,
    curva: entrenada.curva,
    red: entrenada.pesos,
  }, null, 2));
}

async function publicar(historia, o) {
  fs.writeFileSync(path.join(MODELOS, "coevolucion.json"), JSON.stringify({ creado: new Date().toISOString(), opciones: o, historia }, null, 2));
  // El informe se rehace en cada ronda, para poder mirarlo mientras entrena.
  try {
    await generarInforme();
  } catch (e) {
    console.error("  (el informe falló, el entrenamiento sigue:", e.message + ")");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
