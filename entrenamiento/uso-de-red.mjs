// ¿Cuánta red se está usando de verdad?
//
// Tres preguntas que parecen la misma y no lo son:
//
//   1. ¿Cuántas neuronas se activan?  No sirve con leaky ReLU: una neurona
//      siempre negativa sigue pasando 0,01x, así que "nunca positiva" no
//      significa "apagada".
//   2. ¿Cuánta magnitud saca cada una?  Tampoco: una salida pequeña
//      multiplicada por un peso grande mueve la predicción igual.
//   3. ¿Qué pasa si la quito?  ESTA. Se pone su salida a cero y se mide cuánto
//      cambia lo que la red predice. No depende de la escala de nada.
//
// Y una cuarta que resultó ser la importante: ¿la red hace algo que una recta
// no haga? Se ajusta la mejor función lineal a sus propios logits y se mira si
// ordena igual. Si ordena igual, las capas ocultas no están comprando nada.
//
// Salió que la red de despliegue es EXACTAMENTE lineal (R² 1,000) y la de
// jugada casi (0,92). Eso explica el barrido de capacidad plano sin recurrir a
// neuronas muertas, que ya fue una explicación mía equivocada.

import { adelante } from "../src/motor/red.js";

// Cuánto mueve la predicción quitar cada neurona de la única capa oculta.
export function ablacion(red, entradas) {
  const ocultas = red.capas[1];
  const anchoSalida = red.capas[2];
  const w2 = red.pesos[1];
  const b2 = red.sesgos[1];
  const sig = (x) => 1 / (1 + Math.exp(-x));

  const efecto = new Array(ocultas).fill(0);
  for (const e of entradas) {
    const h = adelante(red, e)[1];
    let z = b2[0];
    for (let i = 0; i < ocultas; i++) z += h[i] * w2[i * anchoSalida];
    const base = sig(z);
    for (let k = 0; k < ocultas; k++) efecto[k] += Math.abs(sig(z - h[k] * w2[k * anchoSalida]) - base);
  }
  const medias = efecto.map((s, k) => ({ neurona: k, efecto: s / entradas.length }));
  medias.sort((a, b) => b.efecto - a.efecto);
  return {
    ocultas,
    utiles: medias.filter((m) => m.efecto > 0.01).length,
    marginales: medias.filter((m) => m.efecto > 0.001 && m.efecto <= 0.01).length,
    inertes: medias.filter((m) => m.efecto <= 0.0001).length,
    orden: medias,
  };
}

// ¿Ordena la red como lo haría una recta? Ajuste por mínimos cuadrados a sus
// propios logits, resuelto con ecuaciones normales y una regularización mínima
// para que la matriz no se vuelva singular con rasgos constantes.
export function linealidad(red, entradas, { pares = 20000, semilla = 7 } = {}) {
  const n = entradas.length;
  const d = entradas[0].length;
  const z = entradas.map((e) => adelante(red, e).logit);

  const A = new Float64Array((d + 1) * (d + 1));
  const b = new Float64Array(d + 1);
  for (let m = 0; m < n; m++) {
    const x = entradas[m];
    for (let i = 0; i <= d; i++) {
      const xi = i === d ? 1 : x[i];
      for (let j = 0; j <= d; j++) A[i * (d + 1) + j] += xi * (j === d ? 1 : x[j]);
      b[i] += xi * z[m];
    }
  }
  for (let i = 0; i <= d; i++) A[i * (d + 1) + i] += 1e-6;

  // Eliminación gaussiana con pivoteo parcial.
  const M = A;
  const w = Float64Array.from(b);
  const N = d + 1;
  for (let c = 0; c < N; c++) {
    let piv = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(M[r * N + c]) > Math.abs(M[piv * N + c])) piv = r;
    if (piv !== c) {
      for (let k = 0; k < N; k++) { const t = M[c * N + k]; M[c * N + k] = M[piv * N + k]; M[piv * N + k] = t; }
      const t = w[c]; w[c] = w[piv]; w[piv] = t;
    }
    const p = M[c * N + c] || 1e-12;
    for (let r = c + 1; r < N; r++) {
      const f = M[r * N + c] / p;
      if (!f) continue;
      for (let k = c; k < N; k++) M[r * N + k] -= f * M[c * N + k];
      w[r] -= f * w[c];
    }
  }
  for (let c = N - 1; c >= 0; c--) {
    let s = w[c];
    for (let k = c + 1; k < N; k++) s -= M[c * N + k] * w[k];
    w[c] = s / (M[c * N + c] || 1e-12);
  }

  const zl = entradas.map((x) => {
    let s = w[d];
    for (let i = 0; i < d; i++) s += w[i] * x[i];
    return s;
  });
  const media = z.reduce((a, v) => a + v, 0) / n;
  let sr = 0, st = 0;
  for (let i = 0; i < n; i++) { sr += (z[i] - zl[i]) ** 2; st += (z[i] - media) ** 2; }

  // Lo que de verdad usa el juego no es el valor, es el ORDEN.
  let semillaActual = semilla >>> 0;
  const siguiente = () => ((semillaActual = (semillaActual * 1664525 + 1013904223) >>> 0) / 4294967296);
  let iguales = 0, mirados = 0;
  for (let k = 0; k < pares; k++) {
    const i = Math.floor(siguiente() * n);
    const j = Math.floor(siguiente() * n);
    if (i === j) continue;
    mirados++;
    if ((z[i] > z[j]) === (zl[i] > zl[j])) iguales++;
  }
  // Los pesos salen también, para poder CONSTRUIR la red lineal equivalente y
  // hacerla jugar. Que dos funciones ordenen igual sobre unas muestras es un
  // indicio; que jueguen igual una tanda entera es la prueba.
  return {
    r2: st ? 1 - sr / st : 1,
    ordenIgual: mirados ? iguales / mirados : 1,
    pares: mirados,
    pesos: Array.from(w.slice(0, d)),
    sesgo: w[d],
  };
}
