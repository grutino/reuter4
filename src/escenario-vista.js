// Dibuja un escenario para que una persona lo juzgue.
//
// LA REGLA DE INFORMACIÓN MANDA TAMBIÉN AQUÍ, y es lo que hace que el juicio
// valga: se enseña lo que vería quien mueve —sus propios rangos y, de los
// enemigos, solo los que ya se han visto en combate (`rangosRevelados`)— y nada
// más. Juzgar una jugada viendo los rangos escondidos del rival sería juzgar
// otro juego, y la red aprendería de un consejo que ella nunca podrá seguir.
//
// El compañero tampoco enseña sus rangos: es la misma regla de la partida.

import { ANILLO, TORRE } from "./motor/tablero.js";
import { ESTILO, NOMBRE_RANGO } from "./estilo.js";
import { centro, CELDA, TABLERO_PX, fondoDelTablero } from "./informe-partida.js";

const CASILLA = (c) => (c === ANILLO ? "anillo" : c === TORRE ? "torre" : c);

// Lo que ve quien mueve. Devuelve `rango: null` para lo que no puede saber.
export function vistaDelEscenario(estado, color) {
  const memoria = estado.rangosRevelados || {};
  return Object.values(estado.piezas).map((p) => ({
    id: p.id,
    color: p.color,
    casilla: p.casilla,
    bandera: p.bandera,
    rango: p.color === color ? p.rango : memoria[p.id] !== undefined ? memoria[p.id] : null,
    revelada: p.color !== color && memoria[p.id] !== undefined,
  }));
}

// El dibujo va AUTOCONTENIDO: el fondo se inyecta entero y las fichas van como
// <image> propias, en vez de referenciar símbolos compartidos con <use>. Es más
// grande —unos 30 KB por escenario— y da igual, porque esto es una herramienta
// local que se abre a mano. La versión con símbolos compartidos se quedaba en
// blanco: la cadena traía sus 309 rectángulos pero al insertarla en el DOM el
// símbolo llegaba vacío, y pelearse con eso no aporta nada aquí.
export function tableroDelEscenario(estado, color, accion, fichas) {
  const piezas = vistaDelEscenario(estado, color);
  const lado = CELDA * 0.92;

  const dibujos = piezas.map((p) => {
    const c = centro(p.casilla);
    if (!c) return "";
    const marca = p.bandera
      ? `<circle cx="${c.x}" cy="${c.y}" r="${CELDA * 0.52}" fill="none" stroke="#C9A227" stroke-width="2.5"/>`
      : "";
    // Con rango conocido va la ficha del juego; tapada, un disco liso. Un borde
    // punteado señala "esta la vi en un combate", que es distinto de "es mía".
    const url = fichas && p.rango ? fichas[`${p.color}-${p.rango}`] : null;
    if (url) {
      const aro = p.revelada
        ? `<circle cx="${c.x}" cy="${c.y}" r="${CELDA * 0.5}" fill="none" stroke="#2b2620" stroke-width="1.4" stroke-dasharray="3 2"/>`
        : "";
      return `<image href="${url}" x="${c.x - lado / 2}" y="${c.y - lado / 2}" width="${lado}" height="${lado}"/>` + aro + marca;
    }
    if (p.rango) {
      return `<circle cx="${c.x}" cy="${c.y}" r="${CELDA * 0.4}" fill="${ESTILO[p.color].css}" stroke="#fff"/>` +
        `<text x="${c.x}" y="${c.y + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${p.rango}</text>` + marca;
    }
    // Tapada: disco liso del color, sin número.
    return `<circle cx="${c.x}" cy="${c.y}" r="${CELDA * 0.38}" fill="${ESTILO[p.color].css}" opacity="0.75" stroke="#fff" stroke-width="1"/>` + marca;
  });

  let flecha = "";
  if (accion) {
    const a = centro(accion.desde);
    const b = centro(accion.hasta);
    if (a && b) {
      const trazo = accion.tipo === "disparar" ? "6 3" : "";
      flecha =
        `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#111" stroke-width="3.2" opacity="0.9" stroke-dasharray="${trazo}" marker-end="url(#puntaJuicio)"/>` +
        `<circle cx="${a.x}" cy="${a.y}" r="${CELDA * 0.58}" fill="none" stroke="#111" stroke-width="2.2"/>`;
    }
  }

  return `<svg viewBox="0 0 ${TABLERO_PX} ${TABLERO_PX}" width="100%">
    <defs><marker id="puntaJuicio" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,0 L8,4 L0,8 z" fill="#111"/></marker></defs>
    ${fondoDelTablero()}${dibujos.join("")}${flecha}
  </svg>`;
}

export function textoDeAccion(accion, estado, color) {
  const pieza = estado.piezas[accion.pieza];
  const quien = pieza && pieza.color === color ? NOMBRE_RANGO[pieza.rango] : "una pieza";
  const verbo = accion.tipo === "disparar" ? "dispara a" : accion.tipo === "atacar" ? "ataca" : "va a";
  return `el ${quien} de ${CASILLA(accion.desde)} ${verbo} ${CASILLA(accion.hasta)}`;
}
