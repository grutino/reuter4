// Lanzador del taller de juicios en su propio puerto, para quien prefiera el
// terminal a abrirlo desde el juego.
//
// La lógica NO vive aquí: vive en `servidor/juicios.mjs`, y el servidor del juego
// monta las mismas rutas en /juicios. Tener dos implementaciones de lo mismo
// acaba siempre igual — se arregla una y la otra se queda con el fallo.
//
//   node herramientas/juzgar-despliegues.mjs [puerto]

import http from "node:http";
import { cargarModelos } from "../src/motor/modelos.js";
import { atender, estado } from "../servidor/juicios.mjs";

const PUERTO = Number(process.argv[2] || 8124);
const modelos = cargarModelos();

const servidor = http.createServer((peticion, respuesta) => {
  let url = (peticion.url || "/").split("?")[0];
  // Suelto, la raíz es el taller: aquí no hay juego que servir.
  if (url === "/") url = "/juicios";
  if (atender(peticion, respuesta, url, modelos.despliegue)) return;
  respuesta.writeHead(404).end("no existe");
});

servidor.listen(PUERTO, () => {
  const e = estado(modelos.despliegue, modelos.jugada);
  console.log(`Taller de juicios en http://localhost:${PUERTO}`);
  console.log(`  ${e.juzgados} valoraciones · ${e.enElPozo} despliegues de partidas jugadas`);
  console.log(`  ${modelos.despliegue ? "con red publicada: se podrá comparar tu juicio con el suyo" : "sin red publicada"}`);
  if (e.sinCosechar) console.log(`  ${e.sinCosechar} partida(s) por cosechar`);
  console.log("  Ctrl+C para parar.");
});
