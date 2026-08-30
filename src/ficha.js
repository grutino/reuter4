// Dibujo de una ficha: disco del color del ejército con la silueta del rango en
// oro. Vive aparte porque lo usan dos sitios muy distintos —la textura de las
// piezas del tablero 3D y la ventana de combate, que es plana— y conviene que la
// ficha se vea igual en los dos.
//
// El color de fondo llega como parámetro, no importado: así este módulo no
// depende de `Tablero3D.jsx` y no se monta un ciclo de importaciones.

import { dibujarSilueta } from "./siluetas.js";

export const LADO_FICHA = 128;

const ORO = "#E9C979";
const BORDE = "#1E1A14";

export function pintarFicha(ctx, rango, fondoCss) {
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
  ctx.fillStyle = ORO;
  ctx.strokeStyle = ORO;
  if (!dibujarSilueta(ctx, rango, { hueco: fondo })) {
    // Sin dibujo para ese rango se cae al número, que siempre se puede pintar.
    ctx.font = "bold 66px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(rango), c, c);
  }
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
