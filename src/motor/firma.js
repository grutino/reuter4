// Firma del juego de rasgos con el que se entrenó un modelo.
//
// El número de entradas no basta para saber si un modelo sigue siendo válido.
// `juntoALago` se convirtió en `cubiertoPorLago` sin cambiar cuántas entradas
// hay: los modelos viejos habrían pasado la comprobación de tamaño y habrían
// seguido jugando, con un peso entrenado sobre un cero constante recibiendo de
// pronto valores que varían. Ruido metido en un modelo que funcionaba, sin dar
// ningún error.
//
// Así que se firma la LISTA DE NOMBRES. Cualquier cambio de nombre, de orden o
// de contenido cambia la firma, y un modelo con otra firma se rechaza.

export function firmaDeRasgos(nombres) {
  // FNV-1a de 32 bits: estable entre ejecuciones y entre versiones de Node, que
  // es lo único que se le pide. No es criptográfica ni le hace falta.
  let h = 0x811c9dc5;
  for (const nombre of nombres) {
    for (let i = 0; i < nombre.length; i++) {
      h ^= nombre.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2f; // separador, para que ["ab","c"] y ["a","bc"] no coincidan
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
