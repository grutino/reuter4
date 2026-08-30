// Red neuronal mínima: perceptrón multicapa con retropropagación y Adam.
//
// Escrita a mano y sin dependencias por la misma razón que todo lo demás del
// proyecto: la red entrenada acaba siendo un JSON de números que el juego carga
// y evalúa con veinte líneas, sin arrastrar una cadena de herramientas de
// Python al servidor.
//
// Por qué una red y no seguir con el evolutivo: el evolutivo escoge entre
// candidatos enteros por su resultado final, así que necesita que la diferencia
// entre dos candidatos supere el ruido de las partidas, y con 26 pesos ya no lo
// hacía. El descenso de gradiente no compara candidatos: reparte la culpa del
// error entre todos los parámetros a la vez, ejemplo a ejemplo. Eso escala a
// cientos de parámetros con miles de posiciones etiquetadas.

// Capas: [entradas, oculta, ..., 1]. Oculta con ReLU, salida con sigmoide.
export function crearRed(capas, azar = Math.random) {
  const pesos = [];
  const sesgos = [];
  for (let i = 1; i < capas.length; i++) {
    const entradas = capas[i - 1];
    const salidas = capas[i];
    // He: varianza 2/n para ReLU, que evita que la señal se apague al propagar.
    const escala = Math.sqrt(2 / entradas);
    const w = new Float64Array(entradas * salidas);
    for (let k = 0; k < w.length; k++) w[k] = (azar() * 2 - 1) * escala;
    pesos.push(w);
    sesgos.push(new Float64Array(salidas));
  }
  return { capas, pesos, sesgos, paso: 0, momento: null };
}

const sigmoide = (x) => 1 / (1 + Math.exp(-x));

// Devuelve las activaciones de todas las capas, que la retropropagación
// necesita: sin ellas habría que volver a pasar hacia delante.
export function adelante(red, entrada) {
  const activaciones = [entrada];
  let actual = entrada;
  for (let c = 0; c < red.pesos.length; c++) {
    const entradas = red.capas[c];
    const salidas = red.capas[c + 1];
    const w = red.pesos[c];
    const b = red.sesgos[c];
    const siguiente = new Float64Array(salidas);
    for (let j = 0; j < salidas; j++) {
      let suma = b[j];
      for (let i = 0; i < entradas; i++) suma += actual[i] * w[i * salidas + j];
      // Última capa: sigmoide, porque la salida es una probabilidad de ganar.
      siguiente[j] = c === red.pesos.length - 1 ? sigmoide(suma) : Math.max(0, suma);
    }
    activaciones.push(siguiente);
    actual = siguiente;
  }
  return activaciones;
}

export function evaluar(red, entrada) {
  const a = adelante(red, entrada);
  return a[a.length - 1][0];
}

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
export function aObjeto(red) {
  return {
    capas: red.capas,
    pesos: red.pesos.map((w) => Array.from(w, (v) => Number(v.toFixed(5)))),
    sesgos: red.sesgos.map((b) => Array.from(b, (v) => Number(v.toFixed(5)))),
  };
}

export function desdeObjeto(obj) {
  return {
    capas: obj.capas,
    pesos: obj.pesos.map((w) => Float64Array.from(w)),
    sesgos: obj.sesgos.map((b) => Float64Array.from(b)),
    paso: 0,
    momento: null,
  };
}
