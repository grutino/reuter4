// Publica los modelos entrenados para que el juego los use.
//
// Copia de `entrenamiento/modelos/` a `src/motor/modelos/`, que es de donde los
// carga el servidor. Es un paso EXPLÍCITO a propósito: entrenar sobrescribe
// `entrenamiento/modelos/` constantemente -una prueba de humo de 120 partidas
// ya pisa un modelo de 4000- y no queremos que un ensayo cambie sin querer cómo
// juegan los bots de las partidas reales.
//
//   node herramientas/publicar-redes.mjs          publica si mejora
//   node herramientas/publicar-redes.mjs --forzar publica igualmente

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TAMANO as TAMANO_DESPLIEGUE, FIRMA as FIRMA_DESPLIEGUE } from "../src/motor/rasgos-despliegue.js";
import { TAMANO as TAMANO_JUGADA, FIRMA as FIRMA_JUGADA } from "../src/motor/rasgos-jugada.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ORIGEN = path.join(AQUI, "..", "entrenamiento", "modelos");
const DESTINO = path.join(AQUI, "..", "src", "motor", "modelos");
const forzar = process.argv.includes("--forzar");
// `--solo jugada` o `--solo despliegue` publica una sola. Sin él van las dos,
// que es como se ha usado siempre desde el terminal.
const iSolo = process.argv.indexOf("--solo");
const solo = iSolo > 0 ? process.argv[iSolo + 1] : null;

const PIEZAS = [
  { fichero: "red-despliegue.json", tamano: TAMANO_DESPLIEGUE, firma: FIRMA_DESPLIEGUE, etiqueta: "despliegue" },
  { fichero: "red-jugada.json", tamano: TAMANO_JUGADA, firma: FIRMA_JUGADA, etiqueta: "jugada" },
];

fs.mkdirSync(DESTINO, { recursive: true });
let publicados = 0;
let bloqueados = 0;

for (const { fichero, tamano, firma, etiqueta } of PIEZAS.filter((x) => !solo || x.etiqueta === solo)) {
  const rutaO = path.join(ORIGEN, fichero);
  const rutaD = path.join(DESTINO, fichero);
  if (!fs.existsSync(rutaO)) {
    console.log(`  ${etiqueta.padEnd(11)} no hay nada entrenado en ${path.relative(process.cwd(), rutaO)}`);
    continue;
  }
  const nuevo = JSON.parse(fs.readFileSync(rutaO, "utf8"));

  // Un modelo con otro número de entradas no es "peor", es inservible: se
  // cargaría sin dar error y jugaría con basura.
  if (!nuevo.red || nuevo.red.capas[0] !== tamano) {
    console.log(`  ${etiqueta.padEnd(11)} RECHAZADO: espera ${nuevo.red ? nuevo.red.capas[0] : "?"} entradas y los rasgos dan ${tamano}. Hay que reentrenar.`);
    bloqueados++;
    continue;
  }
  if (nuevo.firmaRasgos !== firma) {
    console.log(`  ${etiqueta.padEnd(11)} RECHAZADO: entrenado con otros rasgos (firma ${nuevo.firmaRasgos || "ninguna"}, ahora ${firma}). Hay que reentrenar.`);
    bloqueados++;
    continue;
  }

  const viejo = fs.existsSync(rutaD) ? JSON.parse(fs.readFileSync(rutaD, "utf8")) : null;
  const notaN = nuevo.victoriasEnJuego;
  const notaV = viejo ? viejo.victoriasEnJuego : undefined;
  // Solo se comparan las notas si los dos modelos hablan el mismo idioma. Con
  // otra firma de rasgos, el porcentaje del publicado se midió contra otro juego
  // de entradas y no significa lo mismo: compararlos bloquearía la publicación
  // de un modelo bueno por perder contra un número que no es del mismo mundo.
  const comparables = viejo && viejo.firmaRasgos === firma;
  const peor = comparables && notaN !== undefined && notaV !== undefined && notaN < notaV;
  if (viejo && !comparables) {
    console.log(`  ${etiqueta.padEnd(11)} el publicado tiene otra firma (${viejo.firmaRasgos || "ninguna"}): sus notas no son comparables, se sustituye`);
  }

  if (peor && !forzar) {
    console.log(
      `  ${etiqueta.padEnd(11)} NO se publica: el entrenado da ${Math.round(notaN * 100)}% y el publicado ${Math.round(notaV * 100)}%. ` +
        `Con --forzar se publica igual.`
    );
    bloqueados++;
    continue;
  }

  fs.copyFileSync(rutaO, rutaD);
  publicados++;
  console.log(
    `  ${etiqueta.padEnd(11)} publicado` +
      (notaN !== undefined ? ` · ${Math.round(notaN * 100)}% contra el panel` : "") +
      (notaV !== undefined ? ` (antes ${Math.round(notaV * 100)}%)` : "") +
      (peor ? "  [forzado, es peor que el anterior]" : "")
  );
}

console.log(`\n  ${publicados} publicados, ${bloqueados} bloqueados. Los bots los cogen al reiniciar el servidor.`);
