// Servidor mínimo para mirar el informe de entrenamiento desde el navegador.
// La página ya se recarga sola, así que basta con servirla.
//
//   node entrenamiento/mirar.mjs      →  http://localhost:8099

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FICHERO = path.join(AQUI, "informe", "index.html");
const PUERTO = Number(process.env.PUERTO) || 8099;

http
  .createServer((peticion, respuesta) => {
    if (!fs.existsSync(FICHERO)) {
      respuesta.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      respuesta.end("Aún no hay informe. Lanza: npm run entrenar");
      return;
    }
    respuesta.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    fs.createReadStream(FICHERO).pipe(respuesta);
  })
  .listen(PUERTO, () => console.log(`Informe en http://localhost:${PUERTO}`));
