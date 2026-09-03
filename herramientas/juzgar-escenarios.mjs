// Lanzador de la sala de juicios de jugada en su propio puerto, para quien
// prefiera el terminal.
//
// La lógica NO vive aquí: vive en `servidor/juicios.mjs`, y el servidor del
// juego monta las mismas rutas bajo /juicios. Dos implementaciones de lo mismo
// acaban siempre igual — se arregla una y la otra se queda con el fallo.
//
//   node herramientas/juzgar-escenarios.mjs [puerto]

import http from "node:http";
import { cargarModelos } from "../src/motor/modelos.js";
import { atender, estado, leerJuiciosJugada } from "../servidor/juicios.mjs";

const PUERTO = Number(process.env.PORT || process.argv[2] || 8123);
const modelos = cargarModelos();

const servidor = http.createServer((peticion, respuesta) => {
  let url = (peticion.url || "/").split("?")[0];
  // Suelto, la raíz es directamente la sala de juicios de jugada.
  if (url === "/" || url === "/index.html") url = "/juicios/jugadas";
  if (atender(peticion, respuesta, url, modelos.despliegue, modelos.jugada)) return;
  respuesta.writeHead(404).end("no existe");
});

servidor.listen(PUERTO, () => {
  const e = estado(modelos.despliegue, modelos.jugada);
  console.log(`Sala de juicios de jugada en http://localhost:${PUERTO}`);
  console.log(`  ${e.enElBanco} escenarios en el banco · ${Object.keys(leerJuiciosJugada()).length} jugadas ya juzgadas`);
  if (!e.enElBanco) console.log("  El banco está vacío: npm run escenarios");
  console.log(`  ${modelos.jugada ? "con red publicada: se podrá comparar tu juicio con el suyo" : "sin red de jugada publicada"}`);
  console.log("  Ctrl+C para parar.");
});
