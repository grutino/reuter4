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
import { crearRed, entrenarLote, entrenarPares, evaluar, aObjeto, desdeObjeto, ACTIVACION } from "./red.mjs";
import { construirPanel, medirContraPanel, resumirPanel, cargarAperturas } from "./panel.mjs";
import { crearPiscina, NUCLEOS } from "./paralelo.mjs";
import { CANDIDATAS_UTILES } from "../src/motor/dificultad.js";
import { fuenteDeDespliegues, aColocacion, aTexto } from "./aperturas.mjs";
import { poblacionInicial, siguienteGeneracion, actualizarArchivo } from "./formaciones.mjs";
import { despliegueGuiado } from "./entrenar-despliegue.mjs";
import { accionConRed } from "./entrenar-jugada.mjs";
import { jugadaSoloRed } from "../src/motor/bot-red.js";
import { movimientosLegales } from "../src/motor/motor.js";
import { generarInforme } from "./informe-redes.mjs";
import { CARPETA as CARPETA_ESCENARIOS } from "./escenarios.mjs";
import { paresDeJuicios, resumenDeJuicios, paresDeDespliegue, juiciosAlDia } from "./juicios.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MODELOS = path.join(AQUI, "modelos");
const [EQUIPO_A, EQUIPO_B] = EQUIPOS;

function opciones(argv) {
  const o = {
    rondas: 6, partidas: 400, epocas: 60, lote: 64, decaimiento: 0.001,
    ocultaDespliegue: 16, ocultaJugada: 28, semilla: 1, limite: 400,
    // ENTRENAR COMO SE JUEGA. `candidatas` tiene que ser el mismo número que
    // criba el servidor: entrenar eligiendo entre doce y jugar eligiendo entre
    // cuatro son dos problemas distintos, y la red aprende el que se le enseña.
    candidatas: CANDIDATAS_UTILES, candidatos: 30, escalada: 200, parejasPanel: 6,
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
    // Cuántas veces se repite cada ejemplo del banco de escenarios frente a uno
    // normal. Hay unos cientos contra cientos de miles, así que sin repetirlos
    // no se notarían — y son justamente los que enseñan las situaciones raras.
    pesoEscenarios: 40,
    // Cuánto pesa un par salido de un juicio humano frente a uno de la
    // heurística. Hay decenas contra cientos de miles, y además dicen algo que
    // los rollouts no pueden: con 8 tiradas la misma posición solo correlaciona
    // 0,39 consigo misma, así que hay decisiones que ninguna cantidad de cómputo
    // resuelve y un juicio sí.
    // Cuántas VECES se repiten los pares de los juicios, no cuánto multiplican el
    // gradiente. La primera versión los pesaba y salió mal: con peso 60 los
    // gradientes eran sesenta veces mayores y el entrenamiento se desestabilizó
    // -la fuerza cayó del 84% al 6% en dos rondas mientras la pérdida de
    // validación ni se movía-. Repetir es estable; multiplicar el gradiente, no.
    //
    // MEDIDO, PORQUE HAY UN ACANTILADO. Repitiéndolos x100 la red se hunde al
    // 0-4% de fuerza; a x40 va perfectamente (87%, 82%). El salto es estrecho y
    // no está claro qué se rompe exactamente: lo que sí se puede es medir dónde
    // está y quedarse lejos.
    //
    //   x0   85%, 82%      x10  81%, 87%
    //   x1   83%, 87%      x40  87%, 82%
    //   x3   80%, 89%      x100  2%, 10%   <- se hunde
    //
    // Pero la dosis no era la causa de fondo: con x10 seguía hundiéndose en la
    // ronda 3, cuando se llena el depósito. Ver `pasadasJuicios`.
    //
    // APAGADO POR DEFECTO, y la razón merece leerse antes de encenderlo.
    //
    // Con los primeros 740 juicios la red se hundía al 0-6% de fuerza. No era la
    // dosis -se barrió- ni el escalado del gradiente -se arregló- ni que la
    // exposición creciera con los datos -también se arregló-. Es lo que enseñan:
    //
    //   destilada            12/12 partidas decididas · 108 turnos · 88% avanzan
    //   con juicios a saco    0/12 decididas          · 400 turnos · 89% avanzan
    //
    // Sigue avanzando pero NO TERMINA. Las jugadas marcadas como malas eran las
    // que delatan -capitán dos casillas, explorador en línea-, que son justo las
    // rápidas. La red aprende "no te delates", se queda sin velocidad, mueve de
    // una en una y el rival corona.
    //
    // El consejo humano era bueno y condicional -caro AL PRINCIPIO de la
    // partida- pero 590 pares de 103 posiciones no bastan para que la red saque
    // esa condición: la generaliza a los 400 turnos. Por eso el valor de esos
    // juicios no estuvo en supervisar sino en DIAGNOSTICAR: revelaron que a la
    // red le faltaba vocabulario para el precio de la información, y de ahí
    // salió `delatarmeAhora`, que sí lleva la fase dentro.
    //
    // Para volver a intentarlo hacen falta muchas más posiciones, y sobre todo
    // que estén repartidas por toda la partida y no solo en la apertura.
    pasadasJuicios: 0,
    // Los juicios de DESPLIEGUE van aparte de los de jugada y encendidos. No es
    // asimetría gratuita: los de jugada colapsaron la red enseñándole a no
    // terminar la partida, y los de despliegue están medidos y no cuestan nada
    // -8 pasadas suben el acierto sobre juicios apartados del 73% al 92% con las
    // victorias intactas-. Un despliegue es un objeto completo que se juzga en
    // abstracto; una jugada arrastra toda su posición detrás.
    pasadasJuiciosDespliegue: 8,
    // Cuántos hilos juegan las partidas. 0 = todos los que haya menos uno, que
    // se deja libre para que la máquina siga respondiendo. 1 fuerza el camino de
    // siempre, que es el que permite comprobar que repartir no cambia nada.
    nucleos: 0,
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
    // Confirmar cada adopción en partidas distintas de las que la eligieron.
    // Cuesta dos medidas del panel por candidata -unos 50s con el panel
    // repartido- y evita la deriva por maldición del ganador.
    revalidar: 1,
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

// Los ejemplos del banco, si los hay y si hablan el mismo idioma que los rasgos
// de ahora. La firma se comprueba igual que en los modelos: unos vectores
// guardados con otro juego de rasgos se cargarían como basura sin dar error.
function cargarEscenarios() {
  const ruta = path.join(CARPETA_ESCENARIOS, "ejemplos.json");
  if (!fs.existsSync(ruta)) return [];
  let guardado;
  try {
    guardado = JSON.parse(fs.readFileSync(ruta, "utf8"));
  } catch (e) {
    console.log(`  ! el banco de escenarios no se puede leer (${e.message}), se sigue sin él`);
    return [];
  }
  if (guardado.firmaRasgos !== FIRMA_JUGADA) {
    console.log(`  ! el banco de escenarios se hizo con otros rasgos (${guardado.firmaRasgos || "sin firma"}, ahora ${FIRMA_JUGADA}). Rehazlo: npm run escenarios`);
    return [];
  }
  return (guardado.ejemplos || [])
    .filter((e) => e.entrada && e.entrada.length === TAMANO_JUGADA)
    .map((e) => ({ entrada: Float64Array.from(e.entrada), objetivo: e.objetivo }));
}

function leer(nombre) {
  const f = path.join(MODELOS, nombre);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

// --- Una tanda de partidas ----------------------------------------------------

// LA TANDA, REPARTIDA ENTRE NÚCLEOS.
//
// El 80% del tiempo de una ronda es jugar estas partidas, y son independientes
// entre sí: el candidato obvio para repartir. La máquina tiene diez núcleos y
// hasta ahora se usaba uno.
//
// Lo que NO es independiente es el reparto de formaciones: en el bucle
// secuencial, a cada partida de liga le toca la siguiente formación de la lista,
// y ese "siguiente" depende de cuántas partidas de liga hayan salido antes. Se
// resuelve decidiéndolo TODO en el padre antes de repartir: saber si una partida
// es de liga cuesta un solo número del generador, así que el padre recorre las
// cuatrocientas, asigna formaciones en el mismo orden que el bucle secuencial, y
// cada obrero recibe su lista ya decidida. El reparto sale idéntico.
async function jugarTanda(redD, redJ, o, semillaBase, sacarDespliegue, liga, piscina) {
  // Quién juega contra quién, decidido aquí para que el orden no dependa de en
  // qué hilo caiga cada partida.
  const plan = [];
  let deLiga = 0;
  for (let i = 0; i < o.partidas; i++) {
    const esLiga = generador(semillaBase + i * 7919)() < o.liga;
    let formacion = null;
    if (esLiga && liga && liga.length) {
      const indice = deLiga % liga.length;
      formacion = { indice, rejilla: liga[indice].rejilla };
      deLiga++;
    } else if (esLiga) {
      deLiga++;
    }
    plan.push({ i, formacion });
  }

  const juntar = (trozos) => {
    const deDespliegue = [];
    const deJugada = [];
    const pares = [];
    let decididas = 0;
    for (const t of trozos) {
      for (const x of t.deDespliegue) deDespliegue.push(x);
      for (const x of t.deJugada) deJugada.push(x);
      for (const x of t.pares) pares.push(x);
      decididas += t.decididas;
      for (const [indice, g] of t.ganancias) {
        if (!liga || !liga[indice]) continue;
        liga[indice].gana += g.gana;
        liga[indice].juega += g.juega;
      }
    }
    return { deDespliegue, deJugada, pares, decididas, deLiga };
  };

  // Sin piscina se juega aquí mismo, que es como se jugó siempre: hace falta
  // para poder comparar que el reparto no cambia los resultados.
  if (!piscina || piscina.nucleos <= 1) {
    const ganancias = new Map();
    let decididas = 0;
    const trozo = { deDespliegue: [], deJugada: [], pares: [], decididas: 0, ganancias: [] };
    for (const { i, formacion } of plan) {
      const r = jugarUna(i, redD, redJ, o, semillaBase, sacarDespliegue, formacion);
      for (const x of r.deDespliegue) trozo.deDespliegue.push(x);
      for (const x of r.deJugada) trozo.deJugada.push(x);
      for (const x of r.pares) trozo.pares.push(x);
      decididas += r.decidida;
      if (formacion) {
        const previo = ganancias.get(formacion.indice) || { gana: 0, juega: 0 };
        ganancias.set(formacion.indice, { gana: previo.gana + r.gana, juega: previo.juega + 1 });
      }
    }
    trozo.decididas = decididas;
    trozo.ganancias = [...ganancias];
    return juntar([trozo]);
  }

  // Se reparte en más trozos que núcleos: las partidas no duran lo mismo -unas
  // se deciden en cien turnos y otras llegan al límite de cuatrocientos- y con
  // un trozo por núcleo el hilo que pille las lentas hace esperar a los demás.
  const trozos = piscina.nucleos * 3;
  const porTrozo = Math.ceil(plan.length / trozos);
  const tareas = [];
  const objD = redD ? aObjeto(redD) : null;
  const objJ = redJ ? aObjeto(redJ) : null;
  for (let k = 0; k < plan.length; k += porTrozo) {
    tareas.push({ redD: objD, redJ: objJ, o, semillaBase, partidas: plan.slice(k, k + porTrozo) });
  }
  return juntar(await piscina.ejecutar(tareas));
}

// UNA partida de la tanda, aislada para poder repartirlas entre núcleos. Todo
// lo que necesita entra por parámetros y todo lo que produce sale por el
// resultado: no toca nada de fuera salvo la aptitud de su formación, que se
// devuelve aparte en vez de sumarse in situ.
export function jugarUna(i, redD, redJ, o, semillaBase, sacarDespliegue, formacion) {
  const deDespliegue = [];
  const deJugada = [];
  const pares = [];
  let decidida = 0;

  {
    const azar = generador(semillaBase + i * 7919);
    // El primer número decide si es de liga. Se consume aquí aunque la decisión
    // venga ya tomada de fuera: si no, todos los sorteos siguientes de la
    // partida se desplazarían y saldría otra partida distinta.
    azar();
    const ladoRed = i % 2 === 0 ? EQUIPO_A : EQUIPO_B;
    const conRed = (color) => !formacion || ladoRed.includes(color);

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
      decidida = 1;
    } else {
      valorA = repartoDeTablas(estado);
    }
    const suyo = (color) => (EQUIPO_A.includes(color) ? valorA : 1 - valorA);
    for (const color of COLORES) deDespliegue.push({ entrada: rasgosPorColor[color], objetivo: suyo(color) });
    for (const m of muestras) deJugada.push({ entrada: m.entrada, objetivo: suyo(m.color) });

    // La aptitud de la formación es lo que le saca a las redes. Las tablas
    // cuentan en fracción, que es más información que tirarlas. Sale por el
    // resultado y no se suma aquí: en paralelo cada hilo tiene su copia del
    // objeto y las sumas se perderían.
    const gana = formacion ? (ladoRed === EQUIPO_A ? 1 - valorA : valorA) : 0;
    return { deDespliegue, deJugada, pares, decidida, gana };
  }
}

// --- Continuar el entrenamiento de una red ------------------------------------

// `previa` es la red vigente. Se sigue desde sus pesos, no desde cero, y el
// punto de partida entra como candidato en la parada temprana: si ninguna época
// mejora su validación, la ronda devuelve la red tal cual estaba.
function entrenar(ejemplos, tamano, oculta, o, azar, previa, pares = null, juicios = null) {
  const barajado = ejemplos.slice();
  for (let i = barajado.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [barajado[i], barajado[j]] = [barajado[j], barajado[i]];
  }
  const corte = Math.floor(barajado.length * 0.75);
  const entrenamiento = barajado.slice(0, corte);
  const validacion = barajado.slice(corte);

  // Pérdida Y ACIERTO, y de los dos conjuntos. Antes solo se guardaba la pérdida
  // por época y el acierto final de validación, y con eso no se puede pintar la
  // pareja de curvas que enseña el sobreajuste: la de entrenamiento subiendo
  // mientras la de validación se estanca.
  const medirEn = (red, conjunto) => {
    let perdida = 0;
    let aciertos = 0;
    for (const ej of conjunto) {
      const p = evaluar(red, ej.entrada);
      perdida += -(ej.objetivo * Math.log(p + 1e-9) + (1 - ej.objetivo) * Math.log(1 - p + 1e-9));
      if ((p > 0.5 ? 1 : 0) === (ej.objetivo > 0.5 ? 1 : 0)) aciertos++;
    }
    const n = conjunto.length || 1;
    return { perdida: perdida / n, acierto: aciertos / n };
  };
  const perdidaDe = (red, conjunto) => medirEn(red, conjunto).perdida;

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
      //
      // Esta SÍ debe escalar con los datos: son decenas de miles de pares
      // distintos sacados de miles de posiciones, así que más datos es más
      // variedad, no más repetición.
      if (pares && pares.length) {
        const j = (i * 2) % Math.max(1, pares.length - o.lote);
        entrenarPares(red, pares.slice(j, j + o.lote), { tasa: o.tasa, decaimiento: o.decaimiento });
      }
    }

    // LOS JUICIOS VAN APARTE, CON DOSIS FIJA. Intercalados como el ancla, su
    // exposición crecía con el tamaño del conjunto: al llenarse el depósito en
    // la ronda 3, los lotes de valor se triplicaban y con ellos los pasos sobre
    // los MISMOS 590 juicios. Ahí es donde la red se hundía del 80% al 4%, y por
    // eso el barrido corto de dos rondas no lo veía: nunca llegaba a la ronda
    // donde ocurre.
    //
    // Son pocos y siempre los mismos, así que su dosis tiene que depender de
    // ellos y no de cuántas partidas se hayan jugado.
    if (juicios && juicios.length) {
      const pasadas = o.pasadasDeEstosJuicios ?? o.pasadasJuicios;
      for (let pasada = 0; pasada < pasadas; pasada++) {
        // UNA PASADA ES UN PASO, NO VEINTICINCO. Trocear en lotes multiplica la
        // dosis por el número de lotes sin que el número de "pasadas" lo diga:
        // con 1600 pares y lote 64 son 25 pasos por pasada, veinticinco veces lo
        // que hace entrenar-despliegue.mjs con el mismo número. Se vio: la red
        // de despliegue cayó al 14% contra el panel en la primera prueba.
        //
        // Con los pares eso se puede hacer -y conviene- porque la pérdida
        // pareada ya normaliza por la suma de pesos, así que el gradiente de un
        // conjunto grande no es más grande, solo menos ruidoso.
        if (o.juiciosEnUnPaso) {
          entrenarPares(red, juicios, { tasa: o.tasa, decaimiento: o.decaimiento });
        } else {
          for (let i = 0; i < juicios.length; i += o.lote) {
            entrenarPares(red, juicios.slice(i, i + o.lote), { tasa: o.tasa, decaimiento: o.decaimiento });
          }
        }
      }
    }
    if (epoca % 5 === 0 || epoca === o.epocas) {
      const ent = medirEn(red, entrenamiento);
      const val = medirEn(red, validacion);
      curva.push({
        epoca,
        entrenamiento: Number(ent.perdida.toFixed(5)),
        validacion: Number(val.perdida.toFixed(5)),
        aciertoEntrenamiento: Number(ent.acierto.toFixed(4)),
        aciertoValidacion: Number(val.acierto.toFixed(4)),
      });
      if (val.perdida < mejor) { mejor = val.perdida; mejorPesos = aObjeto(red); epocasUtiles = epoca; }
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
  // SE REPARTE LA MEDIDA DEL PANEL, NO LA TANDA. Medido: de una ronda de 63s,
  // la tanda son 17s, entrenar 8s y el panel 38s. Y repartir la tanda se probó
  // y salió PEOR -9:24 contra 2:00-, porque devuelve cien mil vectores de
  // rasgos y moverlos entre hilos cuesta más que jugar las partidas. El panel
  // devuelve tres números por rival.
  const cuantosNucleos = o.nucleos === 1 ? 1 : (o.nucleos || NUCLEOS);
  const piscina = crearPiscina(cuantosNucleos, "obrero-panel.mjs");
  if (piscina.nucleos > 1) console.log(`  midiendo el panel en ${piscina.nucleos} hilos (de ${NUCLEOS + 1} núcleos, uno se deja libre)`);

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
  const medir = async (rd, rj, semillaBase = 31337) => {
    if (piscina.nucleos <= 1) {
      const aspirante = {
        desplegar: (color, az) => (rd ? despliegueGuiado(color, az, rd, o.candidatos, o.escalada) : despliegueAleatorio(color, az)),
        jugar: (estado, color, az) =>
          !rj ? accionDeBot(estado, color, { azar: az })
          : o.soloRed ? jugadaSoloRed(estado, color, rj, { azar: az })
          : accionConRed(estado, color, rj, { candidatas: o.candidatas, azar: az }),
      };
      return medirContraPanel(aspirante, panel, { parejas: o.parejasPanel, semillaBase });
    }
    // Un encargo por rival. Cada uno lleva las redes serializadas y las opciones
    // con las que el obrero reconstruye el mismo aspirante.
    const objD = rd ? aObjeto(rd) : null;
    const objJ = rj ? aObjeto(rj) : null;
    const tareas = panel.map((rival) => ({
      redD: objD, redJ: objJ, rival, parejas: o.parejasPanel, semillaBase, limite: o.limite,
      o: { candidatos: o.candidatos, escalada: o.escalada, soloRed: o.soloRed, candidatas: o.candidatas },
    }));
    return resumirPanel(await piscina.ejecutar(tareas));
  };

  const partida = await medir(redD, redJ);
  // Lo que se sabe del titular, acumulado desde que se adoptó. Empieza con la
  // medida del punto de partida, que es una medida suya como cualquier otra.
  let titularVisto = { suma: partida.tasa, n: 1 };
  console.log(`  Punto de partida contra el panel: ${(partida.tasa * 100).toFixed(0)}% ±${Math.round(partida.error * 100)} (semilla de referencia)\n`);
  historia.push({ ronda: 0, panel: partida.tasa, error: partida.error, segundos: Math.round((Date.now() - arranque) / 1000) });
  await publicar(historia, o);

  // Depósito de ejemplos: las últimas `memoria` rondas. Entrenar solo con la
  // ronda recién jugada da muy pocos datos y el ajuste va a bandazos.
  const deposito = [];

  // El banco de escenarios: posiciones donde la partida se decide, con una
  // etiqueta POR JUGADA sacada de jugarla de verdad varias veces. Es lo que
  // arregla que una jugada decisiva y una intrascendente de la misma partida
  // ganada reciban la misma etiqueta.
  const escenarios = cargarEscenarios();
  if (escenarios.length) {
    console.log(`  banco de escenarios: ${escenarios.length} ejemplos, con peso x${o.pesoEscenarios}`);
  }

  // Los juicios humanos, como pares de orden. Se leen una vez: son pocos y no
  // cambian mientras entrena.
  const juicios = paresDeJuicios({ peso: 1 });
  const dj = paresDeDespliegue({ peso: 1 });
  const juiciosDespliegue = dj.firma === FIRMA_DESPLIEGUE ? dj.pares : [];
  if (dj.firma !== FIRMA_DESPLIEGUE && dj.pares.length) {
    console.log(`  ! juicios de despliegue IGNORADOS: otra firma de rasgos (${dj.firma}, ahora ${FIRMA_DESPLIEGUE})`);
  } else if (juiciosDespliegue.length) {
    console.log(`  juicios de despliegue: ${dj.comparados} directos + ${dj.cruzados} cruzados = ${juiciosDespliegue.length} pares, ${o.pasadasJuiciosDespliegue} pasadas por época`);
  }
  if (juicios.pares.length) {
    const r = resumenDeJuicios();
    console.log(`  juicios humanos: ${r.total} sobre ${juicios.posiciones} posiciones ` +
      `(${r.buena} buenas, ${r.mala} malas, ${r.indefinida} indefinidas) -> ${juicios.pares.length} pares, ${o.pasadasJuicios} pasadas por época`);
  }
  console.log();

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
    const tTanda = Date.now();
    const tanda = await jugarTanda(redD, redJ, oRonda, o.semilla + ronda * 104729, sacarDespliegue, poblacion, null);
    const msTanda = Date.now() - tTanda;
    deposito.push(tanda);
    while (deposito.length > o.memoria) deposito.shift();
    const todosD = deposito.flatMap((t) => t.deDespliegue);
    const todosJ = deposito.flatMap((t) => t.deJugada);

    // LOS JUICIOS DE DESPLIEGUE ENTRAN AQUÍ, y antes no entraban en ninguna
    // parte: solo los leía entrenar-despliegue.mjs, que no forma parte del
    // nocturno. O sea que la coevolución reentrenaba la red de despliegue cada
    // ronda y se llevaba por delante lo aprendido de ellos sin haberlos visto.
    const tEntrenar = Date.now();
    const nuevaD = entrenar(todosD, TAMANO_DESPLIEGUE, o.ocultaDespliegue,
      { ...oRonda, pasadasDeEstosJuicios: o.pasadasJuiciosDespliegue, juiciosEnUnPaso: true }, azar, redD, null, juiciosDespliegue);
    const todosPares = deposito.flatMap((t) => t.pares || []);
    // Los del banco PESAN, ya no se repiten. Son unos cientos contra cientos de
    // miles y sin darles peso el gradiente ni los nota, pero metiéndolos
    // cuarenta veces se pagaban cuarenta pasadas hacia delante y hacia atrás por
    // cada uno: medido, eran el 51% de todo lo que se entrenaba. Pesar da el
    // mismo gradiente por una sola pasada, y hay una prueba que lo comprueba
    // peso a peso.
    const conEscenarios = escenarios.length
      ? todosJ.concat(escenarios.map((e) => ({ ...e, peso: o.pesoEscenarios })))
      : todosJ;
    // Los juicios van con los pares del ancla: los dos son restricciones de
    // orden, solo que unas las dicta la heurística y otras una persona.
    const nuevaJ = entrenar(
      conEscenarios, TAMANO_JUGADA, o.ocultaJugada, oRonda, azar, redJ,
      o.anclaPares && todosPares.length ? todosPares : null,
      juicios.pares.length ? juicios.pares : null
    );
    const msEntrenar = Date.now() - tEntrenar;
    // Partidas nuevas cada ronda, y el titular las juega también.
    const tMedir = Date.now();
    const semillaMedida = 31337 + ronda * 15485863;
    const [medida, titular] = await Promise.all([
      medir(nuevaD.red, nuevaJ.red, semillaMedida),
      medir(redD, redJ, semillaMedida),
    ]);
    const msMedir = Date.now() - tMedir;

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
    // EL LISTÓN NO SE PONE SOBRE LA ÚLTIMA MEDIDA DEL TITULAR, SINO SOBRE TODAS.
    //
    // El titular es el MISMO modelo hasta que se adopta otro, y cada ronda se
    // vuelve a medir con semillas distintas. Son medidas independientes de la
    // misma cosa, así que promediarlas baja el error como la raíz de cuántas
    // van: con cuatro rondas, de ±2 a ±1.
    //
    // Usando solo la última, el listón se movía con la suerte del titular en vez
    // de con el mérito del aspirante. Se vio en una prueba de cuatro rondas: el
    // titular midió 88, 90 y 94 siendo la misma red, y en la ronda del 94 el
    // listón subió al 96%, donde ninguna mejora razonable puede llegar. El ruido
    // decidía quién entraba, unas veces de más y otras de menos.
    titularVisto.suma += titular.tasa;
    titularVisto.n += 1;
    const tasaTitular = titularVisto.suma / titularVisto.n;
    const errorTitular = titular.error / Math.sqrt(titularVisto.n);
    const listón = tasaTitular + o.margen * Math.hypot(medida.error, errorTitular);
    const candidata = medida.tasa > listón;

    // SEGUNDA OPINIÓN, EN PARTIDAS QUE NO DECIDIERON NADA.
    //
    // Ganar la primera medida basta para ser candidata, no para entrar. Una
    // noche entera lo demostró: nueve sesiones, ocho rondas adoptadas, y el
    // modelo acabó 3,2 puntos POR DEBAJO del punto de partida. Cada adopción se
    // decidía con un error de +-3 y hubo cincuenta y cuatro oportunidades; con
    // ese ruido acaba colándose un aspirante que solo tuvo suerte, y desde ahí
    // se entrena todo lo demás. Es la maldición del ganador en cadena.
    //
    // El remedio es el mismo que ya se aplicó al veredicto de sesión: la partida
    // que te elige no puede ser la que te confirma. Solo se pagan estas dos
    // medidas de más cuando hay candidata, que es lo raro.
    let mejora = candidata;
    let reválida = null;
    if (candidata && o.revalidar) {
      const otraSemilla = semillaMedida ^ 0x5bd1e995;
      const [otraMedida, otroTitular] = await Promise.all([
        medir(nuevaD.red, nuevaJ.red, otraSemilla),
        medir(redD, redJ, otraSemilla),
      ]);
      // En la reválida basta con no ser peor: exigir el margen dos veces
      // seguidas descartaría mejoras de verdad por mala suerte en la segunda.
      mejora = otraMedida.tasa >= otroTitular.tasa;
      reválida = { medida: otraMedida.tasa, titular: otroTitular.tasa, pasa: mejora };
    }
    const vistasDelTitular = titularVisto.n;
    if (mejora) {
      redD = nuevaD.red;
      redJ = nuevaJ.red;
      // Titular nuevo: lo medido antes era de otra red y ya no cuenta. Pero el
      // recién llegado no empieza a ciegas — se le acaba de medir. Se arranca
      // con la RE VÁLIDA si la hubo, que es la medida limpia; la primera está
      // sesgada al alza precisamente por ser la que le hizo ganar.
      const suya = reválida ? reválida.medida : medida.tasa;
      titularVisto = { suma: suya, n: 1 };
    }

    console.log(
      `  ronda ${ronda}  ${todosJ.length} jugadas (${tanda.deLiga}/${o.partidas} de liga, expl ${oRonda.exploracion.toFixed(2)}) · decididas ${tanda.decididas} · ` +
        `panel ${(medida.tasa * 100).toFixed(0)}% vs titular ${(titular.tasa * 100).toFixed(0)}%` +
        (vistasDelTitular > 1 ? ` (media de ${vistasDelTitular}: ${(tasaTitular * 100).toFixed(0)}%)` : "") +
        ` ±${Math.round(medida.error * 100)} · ` +
        `peor ${medida.peor.rival} (${(medida.peor.tasa * 100).toFixed(0)}%)` +
        (reválida
          ? ` · reválida ${(reválida.medida * 100).toFixed(0)}% vs ${(reválida.titular * 100).toFixed(0)}%`
          : "") +
        (mejora ? "  <- adoptadas" : candidata
          ? "  (candidata, pero la reválida no la confirma)"
          : `  (descartadas, hacía falta ${(listón * 100).toFixed(0)}%)`) +
        `  ${Math.round((Date.now() - t0) / 1000)}s` +
        ` [tanda ${Math.round(msTanda / 1000)}s · entrenar ${Math.round(msEntrenar / 1000)}s · panel ${Math.round(msMedir / 1000)}s]`
    );
    console.log(
      `           formación más dura: ${dura.origen} le saca ${(dura.aptitud * 100).toFixed(0)}% ` +
        `en ${dura.juega} partidas · archivo de ${archivo.size}`
    );

    historia.push({
      ronda, panel: mejora ? medida.tasa : titular.tasa,
      medida: medida.tasa, titular: titular.tasa, error: medida.error, adoptadas: mejora,
      candidata, reválida,
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
    const r = await medir(redD, redJ, s + o.veredictoBase);
    finales.push(r.tasa);
    console.log(`    semilla ${s}: ${(r.tasa * 100).toFixed(0)}% ±${Math.round(r.error * 100)} · peor ${r.peor.rival} (${(r.peor.tasa * 100).toFixed(0)}%)`);
  }
  const media = finales.reduce((a, b) => a + b, 0) / finales.length;
  console.log(`\n  Media: ${(media * 100).toFixed(1)}%  ${o.seco ? "(en seco: no se ha guardado nada)" : ""}`);
  console.log(`  Informe: docs/index.html`);
  historia.push({ ronda: "final", veredicto: media, semillas: finales });
  await publicar(historia, o);
  // Los hilos no se mueren solos: sin esto el proceso se queda colgado al final
  // y el nocturno nunca vería terminar la sesión.
  await piscina.cerrar();
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
    activacion: ACTIVACION,
    firmaRasgos: nombre.includes("despliegue") ? FIRMA_DESPLIEGUE : FIRMA_JUGADA,
    creado: new Date().toISOString(),
    origen: "coevolución",
    opciones: o,
    juiciosAlEntrenar: juiciosAlDia(),
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
