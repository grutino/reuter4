// Perceptrón multicapa: solo el paso adelante y la serialización.
//
// Vive en el motor y no en `entrenamiento/` porque el juego lo NECESITA: un bot
// que decide con la red tiene que poder evaluarla mientras se juega la partida.
// La retropropagación no baja aquí, se queda en `entrenamiento/red.mjs`, que
// reexporta todo esto. La regla del proyecto sigue en pie: el motor no importa
// nada de entrenamiento, y entrenamiento sí importa del motor.
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
