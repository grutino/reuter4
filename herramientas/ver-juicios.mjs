// Cuántos juicios hay y en qué se traducen.
//
//   npm run juicios
import { resumenDeJuicios, paresDeJuicios } from "../entrenamiento/juicios.mjs";

const r = resumenDeJuicios();
if (!r.total) {
  console.log("  No hay juicios todavía. Para dar algunos:  npm run juzgar");
  process.exit(0);
}
const p = paresDeJuicios();
console.log(`  ${r.total} juicios: ${r.buena} buenas · ${r.mala} malas · ${r.indefinida} indefinidas`);
console.log(`  ${p.juzgadas} de ellos caen en posiciones del banco actual, repartidos en ${p.posiciones} posiciones`);
console.log(`  -> ${p.pares.length} pares de orden para entrenar`);
if (p.juzgadas < r.total) {
  console.log(`\n  ${r.total - p.juzgadas} juicios son de posiciones que ya no están en el banco.`);
  console.log(`  No se pierden: vuelven a contar si esas posiciones reaparecen, porque la clave`);
  console.log(`  identifica la posición y la jugada, no su sitio en una lista.`);
}
if (!p.pares.length) {
  console.log(`\n  Con menos de dos jugadas juzgadas por posición no hay orden que aprender:`);
  console.log(`  hacen falta al menos dos de la MISMA posición y con veredictos distintos.`);
}
