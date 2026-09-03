// Entrenamiento desatendido: sesiones encadenadas hasta que deje de mejorar.
//
// Lanza tandas de coevolución una detrás de otra, mide cada una en semillas
// frescas y para sola cuando el aprendizaje se congela. Al parar deja un
// diagnóstico con lo que haga falta para decidir si hay que tocar el modelo.
//
//   npm run nocturno                    hasta 40 sesiones o hasta que se congele
//   npm run nocturno -- --horas 8       o hasta que se acaben las horas
//
// DECISIONES QUE IMPORTAN:
//
// · No se publica solo. El proceso escribe en `entrenamiento/modelos/`, que es
//   el taller; los bots juegan con lo que hay en `src/motor/modelos/`, que solo
//   se toca a mano con `npm run publicar-redes`. Un proceso que corre de noche
//   sin nadie mirando no debería cambiar cómo juegan las partidas reales.
//
// · La mejor marca se guarda aparte. Si una sesión tardía sale peor -pasa, las
//   medidas tienen ruido y el bucle es estocástico-, por la mañana sigue estando
//   el mejor modelo de la noche y no el último.
//
// · El veredicto de cada sesión se mide en semillas que esa sesión no ha usado.
//   Reutilizarlas es cómo un 73% acabó anunciado como 84%.
//
// · Congelarse no es "una sesión sin mejorar". Con ruido de ±2 puntos, una
//   sesión plana no dice nada. Hacen falta varias seguidas sin que la mejor
//   marca se mueva más que el ruido.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ejecutar = promisify(execFile);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");
const MODELOS = path.join(AQUI, "modelos");
const BITACORA = path.join(MODELOS, "nocturno.json");
const MEJORES = path.join(MODELOS, "mejores");

function opciones(argv) {
  const o = {
    sesiones: 40, rondas: 6, partidas: 400, epocas: 60, parejasPanel: 8, poblacion: 30,
    // La red decide sobre TODAS las jugadas legales, sin la heurística cribando.
    // Tiene que coincidir con cómo se entrenó el modelo vigente: mezclar los dos
    // caminos entrena una cosa y mide otra.
    soloRed: 1,
    horas: 0,            // 0 = sin límite de tiempo
    // Cuántas sesiones seguidas sin mejorar antes de dar el aprendizaje por
    // congelado, y cuánto tiene que subir la mejor marca para contar como
    // mejora. Un punto porcentual está dentro del ruido; tres, no.
    paciencia: 5, minimaMejora: 0.03,
  };
  for (let i = 2; i < argv.length; i += 2) {
    const clave = argv[i].replace(/^--/, "");
    if (!(clave in o)) throw new Error(`opción desconocida: ${argv[i]}`);
    o[clave] = Number(argv[i + 1]);
  }
  return o;
}

const ahora = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const leer = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);

// Copia de seguridad de los dos modelos, para poder volver a la mejor noche.
function guardarMejores(sesion, veredicto) {
  fs.mkdirSync(MEJORES, { recursive: true });
  for (const f of ["red-despliegue.json", "red-jugada.json"]) {
    const origen = path.join(MODELOS, f);
    if (fs.existsSync(origen)) fs.copyFileSync(origen, path.join(MEJORES, f));
  }
  fs.writeFileSync(path.join(MEJORES, "marca.json"), JSON.stringify({ sesion, veredicto, cuando: ahora() }, null, 2));
}

function restaurarMejores() {
  for (const f of ["red-despliegue.json", "red-jugada.json"]) {
    const guardado = path.join(MEJORES, f);
    if (fs.existsSync(guardado)) fs.copyFileSync(guardado, path.join(MODELOS, f));
  }
}

// Avisar por la vía que funcione sin nadie delante. En macOS, notificación del
// sistema; en cualquier caso, un fichero que se ve al llegar por la mañana.
async function avisar(titulo, cuerpo) {
  fs.writeFileSync(path.join(MODELOS, "AVISO.txt"), `${ahora()}\n\n${titulo}\n\n${cuerpo}\n`);
  if (os.platform() !== "darwin") return;
  try {
    const limpio = (t) => String(t).replace(/["\\]/g, " ").slice(0, 200);
    await ejecutar("osascript", ["-e", `display notification "${limpio(cuerpo)}" with title "${limpio(titulo)}"`]);
  } catch {
    // Sin notificación se sigue igual: el fichero de aviso ya está escrito.
  }
}

async function main() {
  const o = opciones(process.argv);
  const arranque = Date.now();
  const limite = o.horas ? arranque + o.horas * 3600e3 : Infinity;

  const bitacora = leer(BITACORA) || { creado: ahora(), sesiones: [] };
  let mejor = bitacora.sesiones.reduce((m, s) => Math.max(m, s.veredicto || 0), 0);
  let desdeLaMejora = 0;
  let motivo = "se acabaron las sesiones";

  console.log(`Entrenamiento nocturno · ${ahora()}`);
  console.log(`  hasta ${o.sesiones} sesiones de ${o.rondas} rondas x ${o.partidas} partidas`);
  if (o.horas) console.log(`  o hasta ${o.horas} h`);
  console.log(`  se para tras ${o.paciencia} sesiones sin subir al menos ${Math.round(o.minimaMejora * 100)} puntos`);
  if (mejor) console.log(`  viene de una marca previa de ${(mejor * 100).toFixed(1)}%`);
  console.log();

  for (let sesion = bitacora.sesiones.length + 1; sesion <= o.sesiones; sesion++) {
    if (Date.now() > limite) { motivo = "se acabó el tiempo"; break; }

    const t0 = Date.now();
    let salida = "";
    try {
      const r = await ejecutar("node", [
        path.join(AQUI, "coevolucion.mjs"),
        "--rondas", String(o.rondas), "--partidas", String(o.partidas),
        "--epocas", String(o.epocas), "--parejasPanel", String(o.parejasPanel),
        "--poblacion", String(o.poblacion),
        "--soloRed", String(o.soloRed),
        // Semilla distinta cada sesión: si no, todas juegan lo mismo.
        "--semilla", String(1 + sesion * 7919),
        // Y el veredicto también se mide en partidas distintas cada sesión. Con
        // las mismas siempre, quedarse con la mejor sesión de la noche sería
        // otra vez el sesgo del máximo.
        "--veredictoBase", String(sesion * 1000003),
      ], { cwd: RAIZ, maxBuffer: 64 * 1024 * 1024 });
      salida = r.stdout;
    } catch (e) {
      // Una sesión que revienta no debe tumbar la noche entera.
      console.log(`  sesión ${sesion}  FALLÓ: ${String(e.message).split("\n")[0]}`);
      bitacora.sesiones.push({ sesion, error: String(e.message).slice(0, 400), cuando: ahora() });
      fs.writeFileSync(BITACORA, JSON.stringify(bitacora, null, 2));
      continue;
    }

    const m = salida.match(/Media:\s*([\d.]+)%/);
    const veredicto = m ? Number(m[1]) / 100 : null;
    const adoptadas = (salida.match(/<- adoptadas/g) || []).length;
    const minutos = Math.round((Date.now() - t0) / 60000);

    const subio = veredicto !== null && veredicto > mejor + o.minimaMejora;
    if (subio) {
      mejor = veredicto;
      desdeLaMejora = 0;
      guardarMejores(sesion, veredicto);
    } else {
      desdeLaMejora++;
      // Se vuelve al mejor modelo de la noche: si no, una sesión mala arrastra a
      // la siguiente y la noche entera puede irse cuesta abajo.
      restaurarMejores();
    }

    console.log(
      `  sesión ${String(sesion).padStart(2)}  veredicto ${veredicto !== null ? (veredicto * 100).toFixed(1) + "%" : "?"} · ` +
        `${adoptadas}/${o.rondas} rondas adoptadas · mejor ${(mejor * 100).toFixed(1)}%` +
        (subio ? "  <- nueva marca" : `  (${desdeLaMejora}/${o.paciencia} sin mejorar)`) +
        `  ${minutos} min`
    );

    bitacora.sesiones.push({ sesion, veredicto, adoptadas, mejor, subio, minutos, cuando: ahora() });
    bitacora.mejor = mejor;
    fs.writeFileSync(BITACORA, JSON.stringify(bitacora, null, 2));

    if (desdeLaMejora >= o.paciencia) { motivo = "el aprendizaje se ha congelado"; break; }
  }

  restaurarMejores();

  // Veredicto final sobre partidas que no ha visto NINGUNA sesión. La marca de
  // la noche es el máximo de muchas medidas ruidosas y por tanto está sesgada al
  // alza; este número es el que se puede contar.
  let confirmado = null;
  try {
    const { stdout } = await ejecutar("node", [path.join(RAIZ, "herramientas", "medir.mjs"), "999331", "12"], { cwd: RAIZ, maxBuffer: 32 * 1024 * 1024 });
    confirmado = JSON.parse(stdout);
  } catch (e) {
    console.log(`  (no se pudo confirmar en semillas vírgenes: ${String(e.message).split("\n")[0]})`);
  }

  const horas = ((Date.now() - arranque) / 3600e3).toFixed(1);
  const resumen =
    `${motivo}. Mejor marca ${(mejor * 100).toFixed(1)}%` +
    (confirmado ? `, confirmada en ${(confirmado.tasa * 100).toFixed(1)}% sobre partidas vírgenes` : "") +
    `, en ${bitacora.sesiones.length} sesiones y ${horas} h.`;
  console.log(`\n  ${resumen}`);
  bitacora.confirmado = confirmado;
  fs.writeFileSync(BITACORA, JSON.stringify(bitacora, null, 2));

  const diagnostico = await construirDiagnostico(bitacora, mejor, motivo, o, confirmado);
  fs.writeFileSync(path.join(MODELOS, "diagnostico.md"), diagnostico);
  console.log(`  Diagnóstico en entrenamiento/modelos/diagnostico.md`);
  console.log(`  Los bots NO han cambiado: para que jueguen con esto, npm run publicar-redes`);

  await avisar("Reuter4: entrenamiento terminado", resumen);
}

// Lo que hace falta para decidir si tocar el modelo: qué rivales siguen
// ganando, qué rasgos mueven la aguja y cuáles están muertos.
async function construirDiagnostico(bitacora, mejor, motivo, o, confirmado) {
  const l = [];
  l.push(`# Diagnóstico del entrenamiento nocturno`);
  l.push(``, `_${ahora()}_`, ``);
  l.push(`**${motivo}.** Mejor marca de la noche: **${(mejor * 100).toFixed(1)}%** contra el panel.`, ``);
  if (confirmado) {
    l.push(
      `Confirmada en **${(confirmado.tasa * 100).toFixed(1)}%** ±${Math.round(confirmado.error * 100)} sobre partidas que no ha visto ninguna sesión. ` +
        `Esta es la cifra que vale: la marca de la noche es el máximo de muchas medidas ruidosas y está sesgada al alza. ` +
        `Peor rival: \`${confirmado.peor.rival}\` (${(confirmado.peor.tasa * 100).toFixed(0)}%).`,
      ``
    );
  }

  l.push(`## Cómo fue la noche`, ``);
  l.push(`| sesión | veredicto | rondas adoptadas | mejor hasta ahí |`);
  l.push(`|---|---|---|---|`);
  for (const s of bitacora.sesiones) {
    if (s.error) { l.push(`| ${s.sesion} | falló | — | — |`); continue; }
    l.push(`| ${s.sesion} | ${(s.veredicto * 100).toFixed(1)}% | ${s.adoptadas}/${o.rondas} | ${(s.mejor * 100).toFixed(1)}%${s.subio ? " ←" : ""} |`);
  }
  l.push(``);

  // Rivales que siguen ganando: es lo primero que hay que mirar para decidir si
  // falta un rasgo o sobra un peso.
  if (confirmado && confirmado.porRival) {
    l.push(`## Rivales que siguen ganando`, ``);
    l.push(`| rival | clase | victorias |`, `|---|---|---|`);
    for (const r of confirmado.porRival) l.push(`| ${r.rival} | ${r.clase} | ${(r.tasa * 100).toFixed(0)}% |`);
    l.push(``, `Si uno solo destaca por abajo, el problema es una formación concreta y no el nivel general.`, ``);
  }

  // Sensibilidad: qué rasgos mueven la salida. Un rasgo plano es candidato a
  // podarse; uno que domina, a mirarlo con lupa por si tapa a los demás.
  // Solo existe para la red de despliegue: `sensibilidadDeLaRed` perturba
  // vectores de rasgosDeDespliegue, y para la de jugada haría falta el
  // equivalente sobre jugadas concretas, que no está escrito.
  try {
    const { sensibilidadDeDespliegue, sensibilidadDeJugada, planos } = await import("./sensibilidad.mjs");
    const { desdeObjeto } = await import("../src/motor/red.js");

    // Las dos redes, no solo una. La de jugada es la que decide cada turno, así
    // que diagnosticar solo la de despliegue dejaba fuera la mitad que juega.
    const cuales = [
      ["despliegue", leer(path.join(MODELOS, "red-despliegue.json")), (red) => sensibilidadDeDespliegue(red, { muestras: 300 })],
      ["jugada", leer(path.join(MODELOS, "red-jugada.json")), (red) => sensibilidadDeJugada(red, { partidas: 16 })],
    ];
    for (const [nombre, guardado, calcular] of cuales) {
      if (!guardado || !guardado.red) continue;
      const s = calcular(desdeObjeto(guardado.red)).sort((a, b) => Math.abs(b.efecto) - Math.abs(a.efecto));
      l.push(`## Rasgos que más mueven la red de ${nombre}`, ``);
      l.push(`| rasgo | efecto | sentido |`, `|---|---|---|`);
      for (const r of s.slice(0, 14)) {
        l.push(`| ${r.nombre} | ${r.efecto.toFixed(4)} | ${r.efecto > 0 ? "más es mejor" : "menos es mejor"} |`);
      }
      l.push(``);
      const muertos = planos(s);
      l.push(`### Rasgos planos: ${muertos.length} de ${s.length}`, ``);
      l.push(muertos.length ? muertos.map((r) => `\`${r.nombre}\``).join(", ") : "_ninguno: la red usa todos los rasgos_", ``);
    }
  } catch (e) {
    l.push(`_(no se pudo calcular la sensibilidad: ${e.message})_`, ``);
  }

  l.push(`## Qué decidir`, ``);
  l.push(`- Si hay **rasgos planos**, la red no los usa: o están mal calculados, o no distinguen nada. Podarlos acelera y quita ruido.`);
  l.push(`- Si **un rasgo domina** al resto, mirar si tapa a los demás; a veces es real y a veces es escala.`);
  l.push(`- Si **un rival concreto** gana muy por debajo del resto, falta vocabulario para esa situación, no más partidas.`);
  l.push(`- Si el veredicto **oscila sin subir**, el techo puede ser de la arquitectura: más neuronas ocultas, o dos capas.`);
  l.push(`- Si **casi ninguna ronda se adopta**, el listón puede estar demasiado alto: bajar \`--margen\` o subir \`--parejasPanel\` para medir con menos ruido.`);
  l.push(``, `Los bots siguen jugando con lo que hay en \`src/motor/modelos/\`. Para cambiarlo: \`npm run publicar-redes\`.`);
  return l.join("\n") + "\n";
}

main().catch((e) => { console.error(e); process.exit(1); });
