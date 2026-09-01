// Texturas de la escena 3D, generadas al vuelo.
//
// Ni un fichero de imagen: se pintan en un canvas al arrancar y se cachean. Es
// la misma decisión que con las siluetas y por las mismas razones —el proyecto
// no arrastra dependencias ni descargas— y además permite que cada material se
// ajuste con números en vez de con Photoshop.
//
// El ruido es un value noise con interpolación suave y varias octavas. No es
// Perlin, pero para vetas de madera, granos de arena y manchas de piedra la
// diferencia no se ve, y son treinta líneas en vez de una biblioteca.

import * as THREE from "three";

const cache = new Map();
const recordar = (clave, hacer) => {
  if (!cache.has(clave)) cache.set(clave, hacer());
  return cache.get(clave);
};

// --- Ruido --------------------------------------------------------------------

function generadorDeRuido(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Rejilla de valores al azar que se interpola. Se hace CÍCLICA (el índice da la
// vuelta con %) para que la textura se pueda repetir sin costura visible.
function rejilla(lado, semilla) {
  const azar = generadorDeRuido(semilla);
  const v = new Float64Array(lado * lado);
  for (let i = 0; i < v.length; i++) v[i] = azar();
  return { lado, v };
}

const suave = (t) => t * t * (3 - 2 * t);

function valorEn(r, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const tx = suave(x - xi), ty = suave(y - yi);
  const en = (a, b) => r.v[((b % r.lado) + r.lado) % r.lado * r.lado + (((a % r.lado) + r.lado) % r.lado)];
  const s = en(xi, yi) * (1 - tx) + en(xi + 1, yi) * tx;
  const t = en(xi, yi + 1) * (1 - tx) + en(xi + 1, yi + 1) * tx;
  return s * (1 - ty) + t * ty;
}

function fbm(r, x, y, octavas = 4) {
  let suma = 0, amplitud = 0.5, frecuencia = 1, total = 0;
  for (let o = 0; o < octavas; o++) {
    suma += valorEn(r, x * frecuencia, y * frecuencia) * amplitud;
    total += amplitud;
    amplitud *= 0.5;
    frecuencia *= 2;
  }
  return suma / total;
}

// --- Utilidades ----------------------------------------------------------------

function lienzo(lado) {
  const c = document.createElement("canvas");
  c.width = c.height = lado;
  return c;
}

function aTextura(canvas, { repetir = 1, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repetir, repetir);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const mezcla = (a, b, t) => a + (b - a) * t;
const rgb = (r, g, b) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

// Pinta píxel a píxel con una función (x, y en 0..1) → [r, g, b].
function pintarPorPixel(lado, fn) {
  const c = lienzo(lado);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(lado, lado);
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const [r, g, b] = fn(x / lado, y / lado, x, y);
      const i = (y * lado + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// --- Madera --------------------------------------------------------------------
// Vetas: anillos deformados por ruido. El truco es que el anillo no dependa de
// la distancia limpia sino de una coordenada empujada por fbm, que es lo que da
// el aspecto de tabla cortada y no de diana.

export function madera({ lado = 512, semilla = 11, claro = [122, 84, 48], oscuro = [72, 46, 24] } = {}) {
  return recordar(`madera-${semilla}-${lado}`, () => {
    const r = rejilla(64, semilla);
    return aTextura(
      pintarPorPixel(lado, (u, v) => {
        const deformada = u * 9 + fbm(r, u * 5, v * 2, 4) * 2.4;
        const anillo = Math.abs(Math.sin(deformada * Math.PI));
        // Fibras finas encima: ruido muy estirado en una dirección.
        const fibra = fbm(r, u * 120, v * 6, 2);
        const t = Math.min(1, anillo * 0.75 + fibra * 0.35);
        return [
          mezcla(oscuro[0], claro[0], t),
          mezcla(oscuro[1], claro[1], t),
          mezcla(oscuro[2], claro[2], t),
        ];
      }),
      { repetir: 1 }
    );
  });
}

// --- Arena ---------------------------------------------------------------------

export function arena({ lado = 256, semilla = 23, base = [206, 180, 132] } = {}) {
  return recordar(`arena-${semilla}`, () => {
    const r = rejilla(96, semilla);
    return aTextura(
      pintarPorPixel(lado, (u, v, x, y) => {
        const grano = fbm(r, u * 60, v * 60, 3);
        const manchas = fbm(r, u * 6, v * 6, 3);
        const t = grano * 0.35 + manchas * 0.65;
        const k = 0.82 + t * 0.32;
        return [base[0] * k, base[1] * k, base[2] * k];
      }),
      { repetir: 1 }
    );
  });
}

// --- Piedra --------------------------------------------------------------------

export function piedra({ lado = 256, semilla = 41, base = [138, 134, 124] } = {}) {
  return recordar(`piedra-${semilla}`, () => {
    const r = rejilla(64, semilla);
    return aTextura(
      pintarPorPixel(lado, (u, v) => {
        const manchas = fbm(r, u * 8, v * 8, 5);
        const poros = fbm(r, u * 90, v * 90, 2);
        const t = manchas * 0.8 + poros * 0.2;
        const k = 0.72 + t * 0.5;
        return [base[0] * k, base[1] * k, base[2] * k];
      }),
      { repetir: 1 }
    );
  });
}

// --- Ladrillo ------------------------------------------------------------------
// Se dibuja con rectángulos, no con ruido: un aparejo es una rejilla y sale más
// limpio dibujándolo que intentando que el ruido lo insinúe.

export function ladrillo({ lado = 512, filas = 14, semilla = 7 } = {}) {
  return recordar(`ladrillo-${filas}-${semilla}`, () => {
    const c = lienzo(lado);
    const ctx = c.getContext("2d");
    const azar = generadorDeRuido(semilla);
    const alto = lado / filas;
    ctx.fillStyle = "#6b6055"; // mortero
    ctx.fillRect(0, 0, lado, lado);
    for (let f = 0; f < filas; f++) {
      const desfase = f % 2 ? alto : 0; // aparejo a soga
      const anchoBase = alto * 2.2;
      for (let x = -desfase; x < lado; x += anchoBase) {
        const tono = 0.82 + azar() * 0.36;
        ctx.fillStyle = rgb(146 * tono, 96 * tono, 74 * tono);
        ctx.fillRect(x + 1.5, f * alto + 1.5, anchoBase - 3, alto - 3);
        // Un toque más claro arriba: da volumen sin hacer mapa de normales.
        ctx.fillStyle = `rgba(255,240,220,${0.06 + azar() * 0.05})`;
        ctx.fillRect(x + 1.5, f * alto + 1.5, anchoBase - 3, Math.max(1, alto * 0.18));
      }
    }
    return aTextura(c, { repetir: 1 });
  });
}

// --- Cielo ---------------------------------------------------------------------
// Degradado vertical con nubes, para el fondo de la escena. Se usa como textura
// equirectangular, así que las nubes se aplanan cerca del horizonte y eso es
// justo lo que se quiere.

export function cielo({ ancho = 1024, alto = 512, semilla = 3 } = {}) {
  return recordar(`cielo-${semilla}`, () => {
    const c = document.createElement("canvas");
    c.width = ancho; c.height = alto;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 0, alto);
    g.addColorStop(0, "#2f6ea8");
    g.addColorStop(0.45, "#6fa6cf");
    g.addColorStop(0.72, "#b9d3e4");
    g.addColorStop(1, "#dfe6e2");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, ancho, alto);

    const r = rejilla(64, semilla);
    const img = ctx.getImageData(0, 0, ancho, alto);
    for (let y = 0; y < alto; y++) {
      // Las nubes viven en la mitad de arriba y se desvanecen hacia el horizonte.
      // Las nubes bajan hacia el horizonte: la cámara mira el tablero desde
      // arriba, así que lo que se ve del cielo es la franja baja. Puestas altas
      // no las ve nadie.
      const banda = Math.max(0, 1 - Math.abs(y / alto - 0.42) / 0.40);
      if (banda <= 0) continue;
      for (let x = 0; x < ancho; x++) {
        const n = fbm(r, (x / ancho) * 7, (y / alto) * 7, 5);
        const nube = Math.max(0, n - 0.52) / 0.48;
        const a = Math.min(1, nube * banda * 1.5);
        if (a <= 0.01) continue;
        const i = (y * ancho + x) * 4;
        img.data[i] = mezcla(img.data[i], 252, a);
        img.data[i + 1] = mezcla(img.data[i + 1], 250, a);
        img.data[i + 2] = mezcla(img.data[i + 2], 245, a);
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

// --- Agua ----------------------------------------------------------------------
// Un mapa de normales, no un color: el agua se ve por cómo dobla la luz. Se
// anima moviendo el `offset` de la textura en el bucle de dibujo, que cuesta
// cero y basta para que parezca que corre.

// `repeticiones` importa más de lo que parece: con una sola onda por casilla de
// lago la superficie se lee como lisa, porque la normal varía tan despacio que
// no hay reflejo que rompa. Con tres o cuatro ya hay rizo.
export function normalDeAgua({ lado = 256, semilla = 17, repeticiones = 3 } = {}) {
  return recordar(`agua-${semilla}`, () => {
    const r = rejilla(48, semilla);
    const altura = (u, v) => fbm(r, u * 5, v * 5, 3) + 0.35 * Math.sin((u + v) * Math.PI * 6);
    const paso = 1 / lado;
    return aTextura(
      pintarPorPixel(lado, (u, v) => {
        const dx = (altura(u + paso, v) - altura(u - paso, v)) * 2.2;
        const dy = (altura(u, v + paso) - altura(u, v - paso)) * 2.2;
        // Normal en espacio tangente, codificada 0..255 con el eje Z hacia fuera.
        const nx = -dx, ny = -dy, nz = 1;
        const largo = Math.hypot(nx, ny, nz);
        return [((nx / largo) * 0.5 + 0.5) * 255, ((ny / largo) * 0.5 + 0.5) * 255, ((nz / largo) * 0.5 + 0.5) * 255];
      }),
      { repetir: repeticiones, srgb: false }
    );
  });
}
