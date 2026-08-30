// Entrenamiento de la red: retropropagación con Adam.
//
// El paso adelante y la serialización viven en `src/motor/red.js`, porque el
// juego los necesita para que un bot pueda decidir con la red. Aquí queda solo
// lo que hace falta para APRENDER, que el juego no ejecuta nunca. Se reexporta
// lo de allí para que quien entrena tenga todo en un sitio.

import { crearRed, adelante, evaluar, aObjeto, desdeObjeto } from "../src/motor/red.js";
export { crearRed, adelante, evaluar, aObjeto, desdeObjeto };

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
export function entrenarLote(red, ejemplos, { tasa = 0.01, b1 = 0.9, b2 = 0.999, eps = 1e-8, decaimiento = 0 } = {}) {
  prepararMomento(red);
  const capas = red.pesos.length;
  const gw = red.pesos.map((w) => new Float64Array(w.length));
  const gb = red.sesgos.map((b) => new Float64Array(b.length));
  let perdida = 0;

  for (const ej of ejemplos) {
    const act = adelante(red, ej.entrada);
    const salida = act[capas][0];
    const y = ej.objetivo;
    perdida += -(y * Math.log(salida + 1e-9) + (1 - y) * Math.log(1 - salida + 1e-9));

    // Con sigmoide y entropía cruzada, el error de la última capa se simplifica
    // a (predicho - real): las derivadas se cancelan.
    let delta = new Float64Array([salida - y]);

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
        if (anterior[i] <= 0) continue; // derivada de ReLU: cero por debajo
        let suma = 0;
        for (let j = 0; j < salidas; j++) suma += w[i * salidas + j] * delta[j];
        nuevoDelta[i] = suma;
      }
      delta = nuevoDelta;
    }
  }

  const n = ejemplos.length || 1;
  red.paso += 1;
  const correccion1 = 1 - Math.pow(b1, red.paso);
  const correccion2 = 1 - Math.pow(b2, red.paso);
  const m = red.momento;

  for (let c = 0; c < capas; c++) {
    const aplicar = (grad, mm, vv, destino, conDecaimiento) => {
      for (let k = 0; k < destino.length; k++) {
        const g = grad[k] / n + (conDecaimiento ? decaimiento * destino[k] : 0);
        mm[k] = b1 * mm[k] + (1 - b1) * g;
        vv[k] = b2 * vv[k] + (1 - b2) * g * g;
        destino[k] -= (tasa * (mm[k] / correccion1)) / (Math.sqrt(vv[k] / correccion2) + eps);
      }
    };
    aplicar(gw[c], m.mw[c], m.vw[c], red.pesos[c], true);
    aplicar(gb[c], m.mb[c], m.vb[c], red.sesgos[c], false); // los sesgos no se penalizan
  }
  return perdida / n;
}

// A JSON y de vuelta: es lo que se guarda y lo que el juego carga.
