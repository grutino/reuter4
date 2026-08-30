// Algoritmo genético de formaciones: una población de despliegues que compite
// contra las redes, donde las que mejor les ganan sobreviven y se cruzan.
//
// POR QUÉ. Las redes se estancaron contra `humana-02` (25%) y su variante (13%)
// mientras ganaban del 50% al 100% al resto del panel. Intenté caracterizar a
// mano qué la hacía dura y no hay por dónde: fuerza al frente 36, al fondo 27,
// dos piezas altas delante, bandera sobre un 7. Son los valores modales exactos
// del panel; `humana-10` y `humana-11` tienen las mismas cifras. Si no se puede
// saber mirando, que lo descubra la selección.
//
// LA SEPARACIÓN QUE IMPORTA. Esto NO toca el panel. Son dos cosas distintas y
// confundirlas arruinaría la medida:
//
//   · el PANEL es la vara: 38 rivales fijos, semilla 2024, inmutable. Es lo que
//     permite comparar la ronda 8 con la ronda 1 y creerse la diferencia.
//   · la LIGA es el gimnasio: esta población, que cambia todo el rato y se
//     endurece a propósito contra las redes del momento.
//
// Meter las formaciones duras en el panel sería lo intuitivo y sería un error:
// la curva bajaría al endurecerse la vara y no habría forma de distinguir "las
// redes empeoran" de "los rivales mejoran".
//
// LA APTITUD ES ADVERSARIA. Una formación puntúa por lo que le gana a las redes,
// no por ser buena en abstracto. Puede ser una posición mediocre que explota una
// manía concreta; da igual, para entrenar vale igual o más.
//
// Y SALE GRATIS. La aptitud no se mide aparte: las partidas de liga del propio
// entrenamiento son las que puntúan. Se reparten por turno rotatorio para que
// todas jueguen lo mismo.
//
// EL HISTORIAL SE ACUMULA, CON DESCUENTO. Una ronda le da a cada formación unas
// cinco partidas, y con cinco partidas la aptitud es casi ruido: la primera
// versión reseteaba el marcador de las supervivientes y el archivo se quedaba
// vacío porque ninguna llegaba al mínimo de partidas. Ahora la que sobrevive se
// lleva su historial multiplicado por `DESCUENTO`, así que acumula evidencia
// generación tras generación sin quedarse anclada a lo que hizo contra unas
// redes que ya no existen. Es, además, lo que hace que "permanecer" signifique
// algo: una formación vieja y buena tiene un marcador mucho más creíble que una
// recién cruzada.

import { inventarioInicial } from "../src/motor/motor.js";
import { FILAS, COLUMNAS, variar, espejo, guiada, aTexto } from "./aperturas.mjs";

const CENTRO = Math.ceil(COLUMNAS / 2);

// Las 20 celdas de la rejilla, en orden fijo. El centro de la fila 2 es la
// casilla de reclutamiento y no lleva pieza.
export const CELDAS = (() => {
  const salida = [];
  for (let fila = 1; fila <= FILAS; fila++) {
    for (let columna = 1; columna <= COLUMNAS; columna++) {
      if (fila === 2 && columna === CENTRO) continue;
      salida.push({ fila, columna });
    }
  }
  return salida;
})();

// Cuánto pesa el historial viejo al pasar de generación. Las redes cambian,
// así que las partidas de hace tres rondas valen, pero menos.
const DESCUENTO = 0.6;

const clave = (rejilla) => rejilla.slice()
  .sort((a, b) => a.fila - b.fila || a.columna - b.columna)
  .map((p) => p.rango).join("");

// --- Cruce ----------------------------------------------------------------------
//
// Cruzar dos rejillas no es cruzar dos vectores: el resultado tiene que seguir
// teniendo exactamente el inventario del juego, ni un mariscal de más ni un
// explorador de menos. Así que se hereda de los dos padres lo que quepa y lo que
// sobra se repara con las piezas que falten.

export function cruzar(a, b, azar) {
  const porCelda = (r) => {
    const m = {};
    for (const p of r) m[`${p.fila},${p.columna}`] = p.rango;
    return m;
  };
  const ma = porCelda(a);
  const mb = porCelda(b);

  // Cuántas piezas de cada rango pueden usarse.
  const quedan = {};
  for (const r of inventarioInicial()) quedan[r] = (quedan[r] || 0) + 1;

  const salida = CELDAS.map((c) => ({ ...c, rango: 0 }));
  const pendientes = [];

  // Primera pasada: cada celda intenta quedarse con lo que le da su padre.
  // Un padre por celda, sorteado, para que el cruce mezcle de verdad.
  for (let i = 0; i < CELDAS.length; i++) {
    const c = CELDAS[i];
    const k = `${c.fila},${c.columna}`;
    const preferido = azar() < 0.5 ? ma[k] : mb[k];
    const alterno = preferido === ma[k] ? mb[k] : ma[k];
    if (quedan[preferido] > 0) { quedan[preferido]--; salida[i].rango = preferido; }
    else if (quedan[alterno] > 0) { quedan[alterno]--; salida[i].rango = alterno; }
    else pendientes.push(i);
  }

  // Segunda pasada: lo que ningún padre pudo dar se rellena con el resto del
  // inventario, barajado para no meter siempre los mismos rangos en las mismas
  // celdas.
  const resto = [];
  for (const [r, n] of Object.entries(quedan)) for (let i = 0; i < n; i++) resto.push(Number(r));
  for (let i = resto.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [resto[i], resto[j]] = [resto[j], resto[i]];
  }
  pendientes.forEach((i, k) => { salida[i].rango = resto[k]; });

  return salida;
}

// --- Población ---------------------------------------------------------------------

// Semilla de la población: las humanas, sus espejos, guiadas y azar. Arrancar
// solo de las humanas dejaría a la población sin variedad genética desde el
// primer día.
export function poblacionInicial(tamano, humanas, azar) {
  const salida = [];
  const meter = (rejilla, origen) => salida.push({ rejilla, origen, aptitud: 0.5, gana: 0, juega: 0, edad: 0 });

  for (const h of humanas) {
    meter(h.rejilla, h.nombre);
    if (salida.length >= tamano) break;
  }
  for (const h of humanas) {
    if (salida.length >= tamano) break;
    meter(espejo(h.rejilla), `${h.nombre}·espejo`);
  }
  while (salida.length < tamano) {
    const cuantas = 2 + Math.floor(azar() * 3);
    if (humanas.length && azar() < 0.5) {
      const h = humanas[Math.floor(azar() * humanas.length)];
      meter(variar(h.rejilla, 3 + Math.floor(azar() * 8), azar), `${h.nombre}·mutada`);
    } else {
      meter(guiada(azar, cuantas, 120).rejilla, "guiada");
    }
  }
  return salida.slice(0, tamano);
}

// Una generación. `poblacion` viene ya con `gana`/`juega` rellenos por las
// partidas de liga de la ronda.
export function siguienteGeneracion(poblacion, humanas, o, azar) {
  for (const f of poblacion) {
    // Sin partidas jugadas se queda como estaba, no se le inventa una aptitud.
    if (f.juega > 0) f.aptitud = f.gana / f.juega;
    f.edad++;
  }
  const ordenada = poblacion.slice().sort((a, b) => b.aptitud - a.aptitud);

  const elite = Math.max(1, Math.round(poblacion.length * o.elite));
  const sangre = Math.max(1, Math.round(poblacion.length * o.sangreNueva));
  const nueva = [];

  // Las mejores pasan tal cual, con su historial descontado: siguen puntuando
  // contra las redes nuevas pero sin perder lo que ya demostraron.
  for (let i = 0; i < elite; i++) {
    const f = ordenada[i];
    nueva.push({ ...f, gana: f.gana * DESCUENTO, juega: f.juega * DESCUENTO });
  }

  // Sangre nueva: sin esto la población converge a una sola idea y las redes se
  // entrenan contra un único rival disfrazado de cuarenta.
  for (let i = 0; i < sangre; i++) {
    const r = humanas.length && azar() < 0.4
      ? variar(humanas[Math.floor(azar() * humanas.length)].rejilla, 4 + Math.floor(azar() * 8), azar)
      : guiada(azar, 2 + Math.floor(azar() * 3), 120).rejilla;
    nueva.push({ rejilla: r, origen: "sangre nueva", aptitud: 0.5, gana: 0, juega: 0, edad: 0 });
  }

  // El resto, cruces. Padres por torneo: se sortean dos y gana el más apto, que
  // da presión selectiva sin cargarse a los mediocres de golpe.
  const torneo = () => {
    const a = ordenada[Math.floor(azar() * ordenada.length)];
    const b = ordenada[Math.floor(azar() * ordenada.length)];
    return a.aptitud >= b.aptitud ? a : b;
  };
  const vistas = new Set(nueva.map((f) => clave(f.rejilla)));
  let intentos = 0;
  while (nueva.length < poblacion.length && intentos < poblacion.length * 40) {
    intentos++;
    const padre = torneo();
    const madre = torneo();
    let hija = cruzar(padre.rejilla, madre.rejilla, azar);
    if (azar() < o.mutacion) hija = variar(hija, 1 + Math.floor(azar() * 3), azar);
    const k = clave(hija);
    if (vistas.has(k)) continue; // clones no, ocupan sitio sin aportar
    vistas.add(k);
    nueva.push({ rejilla: hija, origen: `${padre.origen}×${madre.origen}`.slice(0, 40), aptitud: 0.5, gana: 0, juega: 0, edad: 0 });
  }
  // Si el cruce no llenó (población muy convergida), se completa con guiadas.
  while (nueva.length < poblacion.length) {
    nueva.push({ rejilla: guiada(azar, 3, 120).rejilla, origen: "relleno", aptitud: 0.5, gana: 0, juega: 0, edad: 0 });
  }

  return { poblacion: nueva, ordenada };
}

// Las más duras de todas las generaciones, para poder mirarlas al acabar.
// El mínimo de partidas es RELATIVO a lo que se está jugando, no un número
// fijo. Con un umbral fijo de 8 el archivo se quedaba vacío en las tiradas
// pequeñas: el historial acumulado converge a (partidas por ronda)/(1-DESCUENTO)
// y en una población de 10 eso son 6,25, que nunca llega. La pregunta correcta
// no es "¿ha jugado bastante?" sino "¿ha jugado tanto como sus compañeras?".
export function actualizarArchivo(archivo, ordenada, ronda, cuantas = 8) {
  const juegos = ordenada.map((f) => f.juega).sort((a, b) => a - b);
  const mediana = juegos[Math.floor(juegos.length / 2)] || 0;
  const minimo = Math.max(3, mediana * 0.8);
  for (const f of ordenada.slice(0, cuantas)) {
    if (f.juega < minimo) continue;
    const k = clave(f.rejilla);
    const previa = archivo.get(k);
    if (!previa || f.aptitud > previa.aptitud) {
      archivo.set(k, { rejilla: f.rejilla, aptitud: f.aptitud, juega: f.juega, origen: f.origen, ronda });
    }
  }
  return archivo;
}

export { aTexto, clave };
