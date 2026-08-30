import { ANILLO, TORRE, ADYACENTES, ZONAS, COLORES, casillasDeZona } from "./tablero.js";
import { nuevaPartida, movimientosLegales, aplicar, reclutar, inventarioInicial, SOCIO } from "./motor.js";

const DIST = (() => {
  const d = { [ANILLO]: 0, [TORRE]: 0 };
  let frente = [ANILLO];
  while (frente.length) {
    const sig = [];
    for (const c of frente) for (const v of ADYACENTES[c]) if (d[v] === undefined) { d[v] = d[c] + 1; sig.push(v); }
    frente = sig;
  }
  return d;
})();

function barajar(l) { for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; }

function despliegueAleatorio(color) {
  const zona = casillasDeZona(color).filter((c) => c !== ZONAS[color].reclutamiento);
  const bandera = ZONAS[color].bandera;
  const resto = barajar(zona.filter((c) => c !== bandera));
  const usadas = [bandera, ...resto.slice(0, 19)];
  const bolsa = barajar(inventarioInicial());
  return usadas.map((casilla, i) => ({ casilla, rango: bolsa[i], bandera: casilla === bandera }));
}

function accionDeBot(estado, color) {
  const acciones = movimientosLegales(estado, color);
  if (!acciones.length) return null;
  let mejor = null, mejorNota = -Infinity;
  for (const a of acciones) {
    const p = estado.piezas[a.pieza];
    const propia = p.bandera && (p.bandera === color || SOCIO[color] === p.bandera);
    let n = Math.random() * 2;
    if (a.tipo === "mover") {
      const antes = DIST[a.desde] ?? 30, despues = DIST[a.hasta] ?? 30;
      if (a.hasta === TORRE && propia) n += 10000;
      else if (propia) n += (antes - despues) * 14 + 6;
      else n += (antes - despues) * 3;
      if (estado.banderasSueltas[a.hasta]) n += 25;
    }
    if (a.tipo === "disparar") n += 55;
    if (a.tipo === "atacar") {
      n += 12 + p.rango * 2.5;
      if (propia) n -= 60;
      if (p.rango <= 2) n -= 15;
      if (a.hasta === ANILLO || a.hasta === TORRE) n += 20;
    }
    if (n > mejorNota) { mejorNota = n; mejor = a; }
  }
  return mejor;
}

const resumen = { victorias: {}, turnos: [], sinGanador: 0, errores: 0 };
for (let partida = 0; partida < 25; partida++) {
  let estado = nuevaPartida(Object.fromEntries(COLORES.map((c) => [c, despliegueAleatorio(c)])),
    { primero: COLORES[Math.floor(Math.random() * 4)] });
  let turnos = 0;
  try {
    while (!estado.fin && turnos < 4000) {
      if (estado.pendiente) { estado = reclutar(estado, Math.max(...estado.pendiente.opciones)); continue; }
      const a = accionDeBot(estado, estado.turno);
      if (!a) break;
      estado = aplicar(estado, a);
      turnos++;
    }
  } catch (e) { resumen.errores++; console.log("  error:", e.message); continue; }
  resumen.turnos.push(turnos);
  if (estado.fin && estado.fin.ganador) {
    const clave = estado.fin.equipo.join("+");
    resumen.victorias[clave] = (resumen.victorias[clave] || 0) + 1;
  } else resumen.sinGanador++;
}
const media = Math.round(resumen.turnos.reduce((a, b) => a + b, 0) / resumen.turnos.length);
console.log("\n25 partidas de bots");
console.log("  victorias por bando:", resumen.victorias);
console.log("  sin ganador:", resumen.sinGanador, "| errores:", resumen.errores);
console.log("  turnos: media", media, "| mínimo", Math.min(...resumen.turnos), "| máximo", Math.max(...resumen.turnos));
