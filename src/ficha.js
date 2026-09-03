// Dibujo de una ficha: disco del color del ejército con la silueta del rango en
// oro. Vive aparte porque lo usan dos sitios muy distintos —la textura de las
// piezas del tablero 3D y la ventana de combate, que es plana— y conviene que la
// ficha se vea igual en los dos.
//
// El color de fondo llega como parámetro, no importado: así este módulo no
// depende de `Tablero3D.jsx` y no se monta un ciclo de importaciones.

import { dibujarSilueta } from "./siluetas.js";

// LA TINTA DE LA SILUETA VA OSCURA, no en oro. Medido el contraste contra los
// cuatro ejércitos, el oro se hunde a 1,60 sobre el amarillo -prácticamente
// invisible- mientras que el negro no baja de 2,68 en ningún caso:
//
//   tinta    rojo  verde  azul  amarillo   peor caso
//   oro      4,15   3,22  4,35      1,60        1,60
//   negro    2,81   3,62  2,68      7,27        2,68
//
// El oro gana en rojo y azul, pero lo que decide es el peor caso: una ficha que
// no se ve sobre su propio color es una ficha que no sirve.
const TINTA = "#141210";

export const LADO_FICHA = 128;

const BORDE = "#1E1A14";

// `tinta` es el color de la silueta. En el visor 3D va en negro, que es como
// se lee mejor sobre la madera y el color del ejército; en los informes y en
// las herramientas de juicio va en blanco, porque ahí la ficha se imprime a un
// tercio de tamaño sobre papel claro y el negro sobre color oscuro se cierra.
export function pintarFicha(ctx, rango, fondoCss, { tinta = TINTA } = {}) {
  const fondo = fondoCss || "#5B4229";
  const c = LADO_FICHA / 2;

  ctx.clearRect(0, 0, LADO_FICHA, LADO_FICHA);
  ctx.fillStyle = fondo;
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = BORDE;
  ctx.lineWidth = 5;
  ctx.stroke();

  // La silueta se recorta al disco para que nada asome por el borde.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, c - 6, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = tinta;
  if (!dibujarSilueta(ctx, rango, { color: tinta, hueco: fondo, lado: LADO_FICHA })) {
    // Sin dibujo para ese rango se cae al número, que siempre se puede pintar.
    ctx.font = "bold 66px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(rango), c, c);
  }
  ctx.restore();

  galon(ctx, rango);
}

// EL GALÓN: un arco en el borde cuya longitud crece con el rango.
//
// Por qué hace falta. Medida la distancia entre las nueve fichas a 46 px -que es
// el tamaño real en el tablero 3D-, las siluetas se vuelven manchas parecidas.
// Las dos más confundibles eran explorador y general, que están en extremos
// opuestos de la escala: confundir un 3 con un 8 cuesta mucho más que confundir
// un 5 con un 6, y sin embargo era la confusión MÁS probable.
//
// El arco lo invierte: como su longitud es proporcional al rango, las parejas
// lejanas en fuerza pasan a ser las más distintas a la vista. Y sobrevive al
// tamaño, porque "cuánto anillo está pintado" se lee incluso a 24 px, donde la
// silueta ya no dice nada.
//
// No sustituye a la silueta, la acompaña: la silueta dice quién es la pieza y el
// arco cuánto pesa. Y encaja con el juego -los galones napoleónicos son
// exactamente esto-, así que no es una muleta pegada encima.
const ORO_GALON = "#E9C979";
const HUECO_GALON = "rgba(30, 26, 20, 0.55)";

function galon(ctx, rango) {
  if (!rango || rango < 1 || rango > 9) return;
  const c = LADO_FICHA / 2;
  const radio = c - 9;
  const grosor = LADO_FICHA * 0.055;
  // Se deja un hueco abajo para ver dónde empieza y dónde acaba: sin él, un
  // rango 9 parecería un anillo completo y no se distinguiría de un 8.
  const inicio = -Math.PI / 2 - Math.PI * 0.82;
  const recorrido = Math.PI * 1.64;

  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineWidth = grosor;
  // La pista entera, tenue: da referencia de cuánto falta.
  ctx.strokeStyle = HUECO_GALON;
  ctx.beginPath();
  ctx.arc(c, c, radio, inicio, inicio + recorrido);
  ctx.stroke();
  // Y lo que ocupa este rango.
  ctx.strokeStyle = ORO_GALON;
  ctx.beginPath();
  ctx.arc(c, c, radio, inicio, inicio + (recorrido * rango) / 9);
  ctx.stroke();
  ctx.restore();
}

// Ficha tapada: lo que se ve de una pieza enemiga en el tablero. Sin marca de
// rango, porque los rangos ajenos no se enseñan nunca fuera de un combate.
export function pintarFichaTapada(ctx, fondoCss) {
  const fondo = fondoCss || "#5B4229";
  const c = LADO_FICHA / 2;
  ctx.clearRect(0, 0, LADO_FICHA, LADO_FICHA);
  ctx.fillStyle = fondo;
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = BORDE;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = "rgba(233, 201, 121, 0.30)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(c, c, c - 18, 0, Math.PI * 2);
  ctx.stroke();
}
