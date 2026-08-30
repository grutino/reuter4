// Siluetas de los nueve rangos, dibujadas a mano con trazados de canvas.
//
// Son dibujos originales, no un calco del arte de Jumbo: la idea es la misma
// —una figura napoleónica dorada sobre el color del ejército— pero el trazo es
// propio. Si algún día quieres usar las siluetas del tablero de verdad, sustituye
// este módulo por imágenes y deja la misma firma: `dibujarSilueta(ctx, rango)`
// pinta dentro de un lienzo de LADO x LADO con el color de relleno ya puesto.
//
// Criterio de dibujo, aprendido a base de mirarlas pequeñas: una ficha se ve a
// unos 45 px y ahí no sobrevive ningún detalle interior. Lo único que separa a un
// rango de otro es la SILUETA EXTERIOR, así que casi todos son bustos con el
// tocado muy grande —que es lo que de verdad distingue a un militar napoleónico—
// y solo tres son figura entera, porque en ellos la pose es la identidad: el
// caballo del capitán, la zancada del explorador y el cañón.

export const LADO = 128;

const CX = 64;

function elipse(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function poligono(ctx, puntos) {
  ctx.beginPath();
  ctx.moveTo(puntos[0][0], puntos[0][1]);
  for (let i = 1; i < puntos.length; i++) ctx.lineTo(puntos[i][0], puntos[i][1]);
  ctx.closePath();
  ctx.fill();
}

function trazo(ctx, puntos, grosor) {
  ctx.lineWidth = grosor;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(puntos[0][0], puntos[0][1]);
  for (let i = 1; i < puntos.length; i++) ctx.lineTo(puntos[i][0], puntos[i][1]);
  ctx.stroke();
}

// Busto común: hombros anchos, cuello corto y cabeza grande. Ocupa la mitad
// inferior del lienzo y deja libre la superior para el tocado, que es donde se
// juega la diferencia entre rangos.
function busto(ctx, { hombros = 30 } = {}) {
  ctx.beginPath();
  ctx.moveTo(CX - 15, 92);
  ctx.quadraticCurveTo(CX - hombros, 96, CX - hombros - 3, 116);
  ctx.lineTo(CX + hombros + 3, 116);
  ctx.quadraticCurveTo(CX + hombros, 96, CX + 15, 92);
  ctx.closePath();
  ctx.fill();
  poligono(ctx, [[CX - 8, 80], [CX + 8, 80], [CX + 8, 94], [CX - 8, 94]]);
  elipse(ctx, CX, 66, 14, 15);
}

// --- 9 Mariscal: casco con cimera y crin ---------------------------------------
function mariscal(ctx) {
  busto(ctx, { hombros: 32 });
  // Casquete ajustado
  ctx.beginPath();
  ctx.arc(CX, 62, 16, Math.PI, 0);
  ctx.fill();
  poligono(ctx, [[CX - 17, 60], [CX + 17, 60], [CX + 17, 55], [CX - 17, 55]]);
  // Cimera alta que cae en crin hacia atrás: la marca del mariscal
  ctx.beginPath();
  ctx.moveTo(CX - 4, 48);
  ctx.quadraticCurveTo(CX - 2, 16, CX + 14, 14);
  ctx.quadraticCurveTo(CX + 26, 22, CX + 30, 58);
  ctx.quadraticCurveTo(CX + 20, 34, CX + 8, 30);
  ctx.quadraticCurveTo(CX + 6, 40, CX + 5, 48);
  ctx.closePath();
  ctx.fill();
}

// --- 8 General: bicornio de través, muy ancho ----------------------------------
function general(ctx) {
  busto(ctx, { hombros: 32 });
  // Bicornio atravesado: la silueta más ancha y baja de todas
  ctx.beginPath();
  ctx.moveTo(CX - 42, 52);
  ctx.quadraticCurveTo(CX, 8, CX + 42, 52);
  ctx.quadraticCurveTo(CX + 20, 44, CX, 44);
  ctx.quadraticCurveTo(CX - 20, 44, CX - 42, 52);
  ctx.closePath();
  ctx.fill();
  elipse(ctx, CX, 40, 5, 6); // escarapela
}

// --- 7 Comandante: corneta al frente -------------------------------------------
function comandante(ctx) {
  busto(ctx, { hombros: 28 });
  // Gorro bajo con visera
  ctx.beginPath();
  ctx.arc(CX, 58, 15, Math.PI, 0);
  ctx.fill();
  poligono(ctx, [[CX - 17, 56], [CX + 17, 56], [CX + 17, 51], [CX - 17, 51]]);
  poligono(ctx, [[CX + 12, 56], [CX + 30, 60], [CX + 30, 54], [CX + 13, 51]]);
  // Corneta grande: el pabellón sale del lienzo hacia la derecha
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(CX + 6, 90, 14, Math.PI * 1.15, Math.PI * 0.35);
  ctx.stroke();
  poligono(ctx, [[CX + 18, 74], [CX + 40, 62], [CX + 44, 78], [CX + 22, 86]]);
}

// --- 6 Capitán: a caballo -------------------------------------------------------
function capitan(ctx) {
  ctx.strokeStyle = ctx.fillStyle;
  // Patas primero, para que el cuerpo las tape por arriba
  trazo(ctx, [[CX - 20, 92], [CX - 26, 116]], 7);
  trazo(ctx, [[CX - 8, 94], [CX - 4, 116]], 7);
  trazo(ctx, [[CX + 14, 92], [CX + 10, 116]], 7);
  trazo(ctx, [[CX + 24, 90], [CX + 30, 114]], 7);
  // Tronco, cuello y testuz
  elipse(ctx, CX + 2, 86, 28, 15);
  poligono(ctx, [[CX + 18, 86], [CX + 30, 58], [CX + 42, 62], [CX + 34, 88]]);
  poligono(ctx, [[CX + 28, 62], [CX + 50, 54], [CX + 52, 66], [CX + 34, 70]]);
  trazo(ctx, [[CX - 26, 76], [CX - 40, 60]], 7); // cola
  // Jinete: torso y chacó, pequeños pero por encima de la línea del caballo
  poligono(ctx, [[CX - 8, 72], [CX + 10, 72], [CX + 13, 44], [CX - 3, 44]]);
  elipse(ctx, CX + 5, 38, 9, 9.5);
  poligono(ctx, [[CX - 4, 34], [CX + 15, 34], [CX + 14, 18], [CX - 2, 18]]);
  elipse(ctx, CX + 6, 15, 4, 5);
}

// --- 5 Teniente: chacó cilíndrico alto con penacho ------------------------------
function teniente(ctx) {
  busto(ctx, { hombros: 28 });
  // Chacó: cilindro alto, ligeramente más ancho arriba
  poligono(ctx, [[CX - 15, 56], [CX + 15, 56], [CX + 17, 22], [CX - 17, 22]]);
  poligono(ctx, [[CX - 19, 57], [CX + 19, 57], [CX + 19, 51], [CX - 19, 51]]); // visera
  elipse(ctx, CX, 16, 7, 9); // penacho
}

// --- 4 Sargento: gorra de cuartel y galones en el pecho -------------------------
function sargento(ctx, { hueco }) {
  busto(ctx, { hombros: 32 });
  // Gorra plana y baja: lo contrario del chacó del teniente
  ctx.beginPath();
  ctx.arc(CX, 58, 16, Math.PI, 0);
  ctx.fill();
  poligono(ctx, [[CX - 20, 58], [CX + 20, 58], [CX + 20, 52], [CX - 20, 52]]);
  // Galones en punta: la marca del suboficial. Van pintados con el color del
  // fondo, no recortados: la textura de la ficha no admite transparencias.
  ctx.save();
  ctx.strokeStyle = hueco;
  ctx.lineWidth = 5;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  for (let i = 0; i < 2; i++) {
    const y = 100 + i * 11;
    ctx.beginPath();
    ctx.moveTo(CX - 16, y);
    ctx.lineTo(CX, y + 8);
    ctx.lineTo(CX + 16, y);
    ctx.stroke();
  }
  ctx.restore();
}

// --- 3 Explorador: figura entera corriendo --------------------------------------
function explorador(ctx) {
  ctx.strokeStyle = ctx.fillStyle;
  ctx.save();
  ctx.translate(CX, 64);
  ctx.rotate(0.16);
  ctx.translate(-CX, -64);
  poligono(ctx, [[CX - 10, 54], [CX + 8, 54], [CX + 12, 88], [CX - 6, 88]]);
  elipse(ctx, CX, 44, 11, 11.5);
  ctx.beginPath();
  ctx.arc(CX, 40, 12, Math.PI, 0);
  ctx.fill();
  poligono(ctx, [[CX - 14, 40], [CX + 14, 40], [CX + 14, 35], [CX - 14, 35]]);
  trazo(ctx, [[CX + 6, 62], [CX + 30, 50]], 6); // brazo señalando
  trazo(ctx, [[CX - 8, 60], [CX - 24, 70]], 6);
  trazo(ctx, [[CX - 5, 88], [CX - 24, 112]], 7); // zancada abierta
  trazo(ctx, [[CX + 10, 88], [CX + 28, 100]], 7);
  ctx.restore();
}

// --- 2 Espía: de paisano, chistera ----------------------------------------------
function espia(ctx, { hueco }) {
  busto(ctx, { hombros: 24 });
  // Chistera: copa estrecha y muy alta sobre un ala ancha y plana. Se hace
  // adrede lo más distinta posible del chacó del teniente, que es el otro
  // sombrero alto y el único con el que se puede confundir de lejos.
  poligono(ctx, [[CX - 10, 52], [CX + 10, 52], [CX + 10, 14], [CX - 10, 14]]);
  poligono(ctx, [[CX - 25, 55], [CX + 25, 55], [CX + 25, 48], [CX - 25, 48]]);
  // Escote en pico de la capa, pintado con el color del fondo.
  ctx.save();
  ctx.fillStyle = hueco;
  ctx.beginPath();
  ctx.moveTo(CX - 10, 94);
  ctx.lineTo(CX, 114);
  ctx.lineTo(CX + 10, 94);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// --- 1 Cañón --------------------------------------------------------------------
function canon(ctx) {
  ctx.strokeStyle = ctx.fillStyle;
  // Tubo
  poligono(ctx, [[CX - 34, 54], [CX + 18, 44], [CX + 21, 60], [CX - 31, 70]]);
  elipse(ctx, CX + 19, 52, 6, 8);
  // Cureña
  poligono(ctx, [[CX - 38, 66], [CX + 6, 58], [CX + 9, 70], [CX - 34, 80]]);
  trazo(ctx, [[CX - 34, 74], [CX + 28, 100]], 7);
  // Rueda
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(CX - 10, 86, 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 5;
  for (let i = 0; i < 3; i++) {
    const a = (Math.PI / 3) * i;
    ctx.beginPath();
    ctx.moveTo(CX - 10 - Math.cos(a) * 21, 86 - Math.sin(a) * 21);
    ctx.lineTo(CX - 10 + Math.cos(a) * 21, 86 + Math.sin(a) * 21);
    ctx.stroke();
  }
  elipse(ctx, CX - 10, 86, 6, 6);
}

const SILUETAS = {
  9: mariscal,
  8: general,
  7: comandante,
  6: capitan,
  5: teniente,
  4: sargento,
  3: explorador,
  2: espia,
  1: canon,
};

// Pinta la silueta del rango con el color de relleno que traiga el contexto.
// Devuelve false si el rango no tiene dibujo, para que quien llame pueda caer
// de vuelta al número.
// `hueco` es el color del fondo sobre el que se pinta: algunos rangos llevan
// detalles en negativo (los galones del sargento, el escote del espía) y la
// textura de una ficha no puede tener zonas transparentes.
export function dibujarSilueta(ctx, rango, { hueco = "#26417E" } = {}) {
  const dibujo = SILUETAS[rango];
  if (!dibujo) return false;
  ctx.save();
  dibujo(ctx, { hueco });
  ctx.restore();
  return true;
}

export const RANGOS_CON_SILUETA = Object.keys(SILUETAS).map(Number);
