// Siluetas de los nueve rangos: las sombras de las figuras del propio juego.
//
// Las máscaras salen de una foto de la tarjeta de referencia, procesada por
// `herramientas/extraer-siluetas.py`, que deja en `siluetas-datos.js` una matriz
// de 1 bit por rango codificada por longitudes de racha. La foto no se versiona;
// lo que se guarda es la silueta derivada.
//
// Cada rango trae dos capas: la sombra maciza y el dibujo interior, que se graba
// encima con el color del disco. Sin esa segunda capa las nueve sombras se
// parecen demasiado entre sí a tamaño de ficha.
//
// Aquí solo se descomprime y se pinta. Cada silueta se compone una vez en un
// lienzo fuera de pantalla y se cachea por rango y colores, porque el tablero
// pide la misma en cuanto se repinta una pieza.

import { SILUETAS } from "./siluetas-datos.js";

export const LADO = 128;
export const ORO = "#E9C979";

const CACHE = {};

function componentesDeColor(css) {
  const limpio = String(css).trim();
  if (limpio[0] === "#" && (limpio.length === 7 || limpio.length === 4)) {
    const corto = limpio.length === 4;
    const leer = (i) => {
      const trozo = corto ? limpio[1 + i].repeat(2) : limpio.slice(1 + i * 2, 3 + i * 2);
      return parseInt(trozo, 16);
    };
    return [leer(0), leer(1), leer(2)];
  }
  return [233, 201, 121]; // si llega algo raro, oro
}

function pintarRachas(imagen, tramos, [r, g, b]) {
  let pixel = 0;
  let encendido = false;
  for (const largo of tramos) {
    if (encendido) {
      for (let k = 0; k < largo; k++) {
        const p = (pixel + k) * 4;
        imagen.data[p] = r;
        imagen.data[p + 1] = g;
        imagen.data[p + 2] = b;
        imagen.data[p + 3] = 255;
      }
    }
    pixel += largo;
    encendido = !encendido;
  }
}

// La sombra maciza en `color` y encima el dibujo interior en `hueco`, que es el
// color del disco: así el contorno de dentro queda grabado sin romper el borde.
function lienzoDeSilueta(rango, color, hueco) {
  const clave = `${rango}|${color}|${hueco}`;
  if (CACHE[clave]) return CACHE[clave];
  const datos = SILUETAS[rango];
  const lienzo = document.createElement("canvas");
  lienzo.width = datos.ancho;
  lienzo.height = datos.alto;
  const ctx = lienzo.getContext("2d");
  const imagen = ctx.createImageData(datos.ancho, datos.alto);
  pintarRachas(imagen, datos.figura, componentesDeColor(color));
  pintarRachas(imagen, datos.hueco, componentesDeColor(hueco));
  ctx.putImageData(imagen, 0, 0);
  CACHE[clave] = lienzo;
  return lienzo;
}

// Pinta la silueta del rango centrada y a la mayor escala que quepa. Devuelve
// false si el rango no tiene dibujo, para que quien llame pueda caer al número.
export function dibujarSilueta(ctx, rango, { color = ORO, hueco = "#26417E", lado = LADO, ocupacion = 0.84 } = {}) {
  if (!SILUETAS[rango]) return false;
  const datos = SILUETAS[rango];
  const lienzo = lienzoDeSilueta(rango, color, hueco);
  const escala = Math.min((lado * ocupacion) / datos.ancho, (lado * ocupacion) / datos.alto);
  const ancho = datos.ancho * escala;
  const alto = datos.alto * escala;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(lienzo, (lado - ancho) / 2, (lado - alto) / 2, ancho, alto);
  return true;
}

export const RANGOS_CON_SILUETA = Object.keys(SILUETAS).map(Number);
