// Entrenamiento de la red: retropropagación con Adam.
//
// El paso adelante y la serialización viven en `src/motor/red.js`, porque el
// juego los necesita para que un bot pueda decidir con la red. Aquí queda solo
// lo que hace falta para APRENDER, que el juego no ejecuta nunca. Se reexporta
// lo de allí para que quien entrena tenga todo en un sitio.

import { crearRed, adelante, evaluar, aObjeto, desdeObjeto, FUGA, ACTIVACION } from "../src/motor/red.js";
export { crearRed, adelante, evaluar, aObjeto, desdeObjeto, ACTIVACION };

function prepararMomento(red) {
  if (red.momento) return;
  red.momento = {
    mw: red.pesos.map((w) => new Float64Array(w.length)),
    vw: red.pesos.map((w) => new Float64Array(w.length)),
    mb: red.sesgos.map((b) => new Float64Array(b.length)),
    vb: red.sesgos.map((b) => new Float64Array(b.length)),
  };
}

// Un paso de Adam sobre un lote. `ejemplos` son { entrada, objetivo }.
// Devuelve la entropía cruzada media, que es lo que se está minimizando.
// `decaimiento` es regularización L2: empuja los pesos hacia cero salvo que
// los datos justifiquen lo contrario. Sin ella, con pocos ejemplos y muchos
// parámetros la red memoriza el ruido y la validación empeora mientras el
// entrenamiento mejora.

// Reparte hacia atrás un error de la capa de salida y acumula gradientes.
// Se extrajo de `entrenarLote` para poder usar OTRA pérdida sin duplicar la
// retropropagación entera: la del orden por pares no compara con un objetivo,
// compara dos jugadas entre sí.
function retropropagar(red, act, errorDeSalida, gw, gb) {
  const capas = red.pesos.length;
  let delta = new Float64Array([errorDeSalida]);
  for (let c = capas - 1; c >= 0; c--) {
    const entradas = red.capas[c];
    const salidas = red.capas[c + 1];
    const anterior = act[c];
    const w = red.pesos[c];
    for (let j = 0; j < salidas; j++) {
      const d = delta[j];
      if (d === 0) continue;
      gb[c][j] += d;
      for (let i = 0; i < entradas; i++) gw[c][i * salidas + j] += anterior[i] * d;
    }
    if (c === 0) break;
    const nuevoDelta = new Float64Array(entradas);
    for (let i = 0; i < entradas; i++) {
      // Derivada de la leaky ReLU: 1 por encima de cero y FUGA por debajo. Con
      // la ReLU normal era cero, y por eso una neurona apagada no volvía nunca.
      const pendiente = anterior[i] > 0 ? 1 : FUGA;
      let suma = 0;
      for (let j = 0; j < salidas; j++) suma += w[i * salidas + j] * delta[j];
      nuevoDelta[i] = suma * pendiente;
    }
    delta = nuevoDelta;
  }
}

export function entrenarLote(red, ejemplos, { tasa = 0.01, b1 = 0.9, b2 = 0.999, eps = 1e-8, decaimiento = 0 } = {}) {
  prepararMomento(red);
  const capas = red.pesos.length;
  const gw = red.pesos.map((w) => new Float64Array(w.length));
  const gb = red.sesgos.map((b) => new Float64Array(b.length));
  let perdida = 0;

  // UN EJEMPLO PUEDE PESAR MÁS QUE OTRO. Antes, para que el banco de escenarios
  // contase cuarenta veces, se metían cuarenta COPIAS de cada uno en el
  // conjunto: eran el 51% de todo lo que se entrenaba, y se pagaba una pasada
  // hacia delante y otra hacia atrás por cada copia. Con el peso en el ejemplo
  // se paga una sola vez y el gradiente sale igual, porque lo que importa es la
  // media ponderada y no cuántas veces aparezca la misma fila.
  //
  // Se normaliza por la SUMA DE PESOS y no por el número de ejemplos, igual que
  // en la pérdida por pares: dividir por el número haría que un lote de peso 40
  // diera pasos cuarenta veces mayores, que es exactamente el fallo que ya
  // desestabilizó el entrenamiento con los juicios humanos.
  let pesoTotal = 0;
  for (const ej of ejemplos) {
    const peso = ej.peso === undefined ? 1 : ej.peso;
    pesoTotal += peso;
    const act = adelante(red, ej.entrada);
    const salida = act[capas][0];
    const y = ej.objetivo;
    perdida += -(y * Math.log(salida + 1e-9) + (1 - y) * Math.log(1 - salida + 1e-9)) * peso;

    // Con sigmoide y entropía cruzada, el error de la última capa se simplifica
    // a (predicho - real): las derivadas se cancelan.
    retropropagar(red, act, (salida - y) * peso, gw, gb);
  }

  const n = pesoTotal || 1;
  aplicarAdam(red, gw, gb, n, { tasa, b1, b2, eps, decaimiento });
  return perdida / n;
}

// El paso de Adam, extraído para que lo compartan la pérdida de valor y la de
// orden por pares. Los sesgos no se penalizan: encoger un sesgo no simplifica el
// modelo, solo lo descentra.
function aplicarAdam(red, gw, gb, n, { tasa, b1, b2, eps, decaimiento }) {
  red.paso += 1;
  const correccion1 = 1 - Math.pow(b1, red.paso);
  const correccion2 = 1 - Math.pow(b2, red.paso);
  const m = red.momento;

  for (let c = 0; c < red.pesos.length; c++) {
    const paso = (grad, mm, vv, destino, conDecaimiento) => {
      for (let k = 0; k < destino.length; k++) {
        const g = grad[k] / n + (conDecaimiento ? decaimiento * destino[k] : 0);
        mm[k] = b1 * mm[k] + (1 - b1) * g;
        vv[k] = b2 * vv[k] + (1 - b2) * g * g;
        destino[k] -= (tasa * (mm[k] / correccion1)) / (Math.sqrt(vv[k] / correccion2) + eps);
      }
    };
    paso(gw[c], m.mw[c], m.vw[c], red.pesos[c], true);
    paso(gb[c], m.mb[c], m.vb[c], red.sesgos[c], false);
  }
}

// A JSON y de vuelta: es lo que se guarda y lo que el juego carga.

// Entrenar por PARES: "esta jugada va por delante de esta otra".
//
// Es lo que permite meter en la red cosas que no son un valor absoluto sino un
// orden. Una heurística y un juicio humano dicen lo mismo desde el punto de
// vista de la red —"esta antes que esta"— y ninguna de las dos sabe decir "esta
// jugada gana el 63% de las veces". Con la pérdida de valor no se pueden
// expresar; con esta, sí.
//
// La pérdida es -log(sigmoide(z_a - z_b)) sobre los logits, así que el gradiente
// en la salida es -(1-s) para la preferida y +(1-s) para la otra. Cuando la red
// ya las ordena bien, s tiende a 1 y el par deja de empujar: no insiste en algo
// que ya está aprendido.
//
// Cada par lleva su `peso`, que es lo que permite que un juicio tuyo cuente más
// que un par sacado de la heurística: hay miles de los segundos y decenas de los
// primeros.
export function entrenarPares(red, pares, { tasa = 0.01, b1 = 0.9, b2 = 0.999, eps = 1e-8, decaimiento = 0 } = {}) {
  prepararMomento(red);
  const capas = red.pesos.length;
  const gw = red.pesos.map((w) => new Float64Array(w.length));
  const gb = red.sesgos.map((b) => new Float64Array(b.length));
  let perdida = 0;
  let aciertos = 0;
  let pesoTotal = 0;

  for (const par of pares) {
    const peso = par.peso === undefined ? 1 : par.peso;
    pesoTotal += peso;
    const actA = adelante(red, par.mejor);
    const actB = adelante(red, par.peor);
    // El logit viene de `adelante`, no de invertir la sigmoide: con la salida
    // saturada las dos jugadas valen 1,0000 y la diferencia desaparece.
    const zA = actA.logit;
    const zB = actB.logit;
    const s = 1 / (1 + Math.exp(-(zA - zB)));
    perdida += -Math.log(s + 1e-9) * peso;
    if (zA > zB) aciertos++;

    const g = (1 - s) * peso;
    retropropagar(red, actA, -g, gw, gb);
    retropropagar(red, actB, g, gw, gb);
  }

  // SE DIVIDE POR LA SUMA DE PESOS, no por el número de pares. Dividiendo por el
  // número, un lote de pares con peso 60 producía gradientes sesenta veces
  // mayores que uno de peso 1: el paso de Adam se disparaba y el entrenamiento
  // se volvía inestable. Pasó de verdad — con los juicios humanos a peso 60, la
  // fuerza de juego se desplomó del 84% al 6% en dos rondas mientras la pérdida
  // de validación ni se movía, porque el daño no estaba en lo que esa pérdida
  // mide.
  //
  // Así el peso es lo que debe ser: cuánto cuenta un par frente a otro DENTRO
  // del lote, no un multiplicador del gradiente. Para que un conjunto pese más
  // en el total hay que repetirlo, que es estable y es lo que ya se hace con los
  // ejemplos del banco de escenarios.
  aplicarAdam(red, gw, gb, pesoTotal || 1, { tasa, b1, b2, eps, decaimiento });
  return { perdida: perdida / (pesoTotal || 1), acierto: aciertos / (pares.length || 1) };
}
