// Banco de pruebas de la escena 3D: monta el tablero con una partida inventada
// para poder mirar los cambios sin levantar servidor ni jugar nada.
import React from "react";
import { createRoot } from "react-dom/client";
import Tablero3D from "../src/Tablero3D.jsx";
import { COLORES } from "../src/motor/tablero.js";
import { nuevaPartida, aplicar } from "../src/motor/motor.js";
import { accionDeBot, despliegueAleatorio } from "../src/motor/bot.js";

const azar = (() => { let a = 20260901 >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; })();

const despliegues = {};
for (const c of COLORES) despliegues[c] = despliegueAleatorio(c, azar);
let e = nuevaPartida(despliegues, { primero: "rojo" });
for (let t = 0; t < 40 && !e.fin; t++) {
  if (e.pendiente) break;
  const a = accionDeBot(e, e.turno, { azar });
  if (!a) break;
  e = aplicar(e, a);
}

// Todos los rangos visibles, para juzgar las fichas.
const piezas = Object.values(e.piezas);

const camara = new URLSearchParams(location.search).get("camara") || "rojo";

createRoot(document.getElementById("raiz")).render(
  <div style={{ padding: 12, background: "#141110", minHeight: "100vh" }}>
    <Tablero3D
      piezas={piezas}
      banderasSueltas={e.banderasSueltas}
      resaltadas={{}}
      zonaPropia={camara}
      colorCamara={camara}
      marcador={{ rojo: 4, verde: 2, azul: 5, amarillo: 1 }}
      explosiones={[{ casilla: "H6", ardiendo: true }, { casilla: "F9", ardiendo: false }]}
      onCasilla={() => {}}
      alto={640}
    />
  </div>
);
