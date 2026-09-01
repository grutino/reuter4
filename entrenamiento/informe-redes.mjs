// Informe de las redes, con el juego de gráficas que se usa habitualmente para
// analizar un modelo. Se escribe en `docs/index.html`, que es lo que publica
// GitHub Pages: así hay una URL fija donde mirar cómo van los modelos.
//
// Qué contesta cada gráfica, que es lo que hace que sirvan para algo:
//
//   · Curvas de aprendizaje → ¿aprende? ¿y se está sobreajustando? Si la de
//     validación sube mientras la de entrenamiento baja, está memorizando.
//   · Calibración → ¿sus probabilidades significan algo? Cuando dice 70%,
//     ¿gana el 70% de las veces? Un modelo puede ordenar bien y mentir en la
//     magnitud.
//   · Distribución de predicciones → ¿discrimina o dice siempre lo mismo? Una
//     campana estrecha en 0,5 es una red que no se moja.
//   · Sensibilidad por rasgo → qué mira de verdad.
//   · Victorias en juego → la única que importa de verdad. Todo lo demás puede
//     estar bien y aun así jugar mal, que es exactamente lo que pasó aquí.
//
//   node entrenamiento/informe-redes.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MODELOS = path.join(AQUI, "modelos");
const DESTINO = path.join(AQUI, "..", "docs", "index.html");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (v) => (v === undefined || v === null ? "—" : `${(v * 100).toFixed(0)}%`);

// --- Gráficas -----------------------------------------------------------------

function ejes(w, h, m, min, max, formato) {
  return [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = m.arriba + (h - (f * h));
      return `<line x1="${m.izq}" y1="${y}" x2="${m.izq + w}" y2="${y}" stroke="var(--filo)" opacity=".45"/>
        <text x="${m.izq - 7}" y="${y + 3.5}" fill="var(--tenue)" font-size="10" text-anchor="end" font-family="'IBM Plex Mono',monospace">${formato(min + f * (max - min))}</text>`;
    })
    .join("");
}

function lineas({ series, alto = 200, ancho = 700, min, max, formato = (v) => v.toFixed(3), etiquetaX = "" }) {
  const m = { arriba: 14, der: 14, abajo: 26, izq: 50 };
  const w = ancho - m.izq - m.der;
  const h = alto - m.arriba - m.abajo;
  const todos = series.flatMap((s) => s.puntos);
  if (todos.length < 2) return "";
  const xs = todos.map((p) => p.x);
  const ys = todos.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 1);
  const lo = min !== undefined ? min : Math.min(...ys);
  const hi = max !== undefined ? max : Math.max(...ys);
  const rango = hi - lo || 1;
  const px = (x) => m.izq + ((x - x0) / (x1 - x0)) * w;
  const py = (y) => m.arriba + h - ((y - lo) / rango) * h;
  const trazos = series
    .map((s) =>
      s.puntos.length < 2
        ? ""
        : `<path d="${s.puntos.map((p, i) => `${i ? "L" : "M"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="${s.grosor || 2}" ${s.guion ? 'stroke-dasharray="4 4"' : ""} stroke-linejoin="round"/>`
    )
    .join("");
  const leyenda = series
    .map((s, i) => `<rect x="${m.izq + 6 + i * 148}" y="${m.arriba}" width="10" height="3" fill="${s.color}"/>
      <text x="${m.izq + 21 + i * 148}" y="${m.arriba + 4}" fill="var(--tenue)" font-size="11" font-family="'IBM Plex Mono',monospace">${esc(s.nombre)}</text>`)
    .join("");
  return `<svg viewBox="0 0 ${ancho} ${alto}" role="img"><g>${ejes(w, h, m, lo, hi, formato)}</g>${trazos}${leyenda}
    <text x="${m.izq + w}" y="${alto - 6}" fill="var(--tenue)" font-size="10" text-anchor="end" font-family="'IBM Plex Mono',monospace">${esc(etiquetaX)}</text></svg>`;
}

function calibracion(puntos, ancho = 340, alto = 260) {
  if (!puntos || !puntos.length) return "";
  const m = { arriba: 14, der: 14, abajo: 32, izq: 42 };
  const w = ancho - m.izq - m.der;
  const h = alto - m.arriba - m.abajo;
  const px = (v) => m.izq + v * w;
  const py = (v) => m.arriba + h - v * h;
  const maxN = Math.max(...puntos.map((p) => p.n));
  const bolas = puntos
    .map((p) => `<circle cx="${px(p.predicho).toFixed(1)}" cy="${py(p.real).toFixed(1)}" r="${(3 + 7 * Math.sqrt(p.n / maxN)).toFixed(1)}" fill="var(--laton)" opacity=".75"/>`)
    .join("");
  const rejilla = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => `<line x1="${px(f)}" y1="${m.arriba}" x2="${px(f)}" y2="${m.arriba + h}" stroke="var(--filo)" opacity=".35"/>
      <line x1="${m.izq}" y1="${py(f)}" x2="${m.izq + w}" y2="${py(f)}" stroke="var(--filo)" opacity=".35"/>
      <text x="${px(f)}" y="${alto - 14}" fill="var(--tenue)" font-size="9.5" text-anchor="middle" font-family="'IBM Plex Mono',monospace">${(f * 100).toFixed(0)}</text>
      <text x="${m.izq - 6}" y="${py(f) + 3}" fill="var(--tenue)" font-size="9.5" text-anchor="end" font-family="'IBM Plex Mono',monospace">${(f * 100).toFixed(0)}</text>`)
    .join("");
  return `<svg viewBox="0 0 ${ancho} ${alto}" role="img">${rejilla}
    <line x1="${px(0)}" y1="${py(0)}" x2="${px(1)}" y2="${py(1)}" stroke="var(--tenue)" stroke-dasharray="4 4"/>
    ${bolas}
    <text x="${m.izq + w / 2}" y="${alto - 2}" fill="var(--tenue)" font-size="10" text-anchor="middle" font-family="'IBM Plex Mono',monospace">predicho</text></svg>`;
}

function histograma(puntos, ancho = 340, alto = 260) {
  if (!puntos || !puntos.length) return "";
  const m = { arriba: 14, der: 14, abajo: 32, izq: 42 };
  const w = ancho - m.izq - m.der;
  const h = alto - m.arriba - m.abajo;
  const maxN = Math.max(...puntos.map((p) => p.n));
  const ancho1 = w / 10;
  const barras = puntos
    .map((p) => {
      const idx = Math.min(9, Math.floor(p.predicho * 10));
      const altura = (p.n / maxN) * h;
      return `<rect x="${(m.izq + idx * ancho1 + 1.5).toFixed(1)}" y="${(m.arriba + h - altura).toFixed(1)}" width="${(ancho1 - 3).toFixed(1)}" height="${altura.toFixed(1)}" fill="var(--dato)" opacity=".8" rx="1"/>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${ancho} ${alto}" role="img">
    <line x1="${m.izq}" y1="${m.arriba + h}" x2="${m.izq + w}" y2="${m.arriba + h}" stroke="var(--filo)"/>
    ${barras}
    <text x="${m.izq + w / 2}" y="${alto - 2}" fill="var(--tenue)" font-size="10" text-anchor="middle" font-family="'IBM Plex Mono',monospace">probabilidad que predice</text></svg>`;
}

function arquitectura(capas, ancho = 340, alto = 200) {
  if (!capas) return "";
  const paso = ancho / (capas.length + 1);
  const nodos = capas
    .map((n, c) => {
      const x = paso * (c + 1);
      const dibujar = Math.min(n, 9);
      const circulos = Array.from({ length: dibujar }, (_, i) => {
        const y = alto / 2 + (i - (dibujar - 1) / 2) * 17;
        return `<circle cx="${x}" cy="${y}" r="5" fill="${c === 0 ? "var(--dato)" : c === capas.length - 1 ? "var(--bien)" : "var(--laton)"}" opacity=".85"/>`;
      }).join("");
      const etiqueta = c === 0 ? "entradas" : c === capas.length - 1 ? "salida" : "oculta";
      return `${circulos}<text x="${x}" y="${alto - 8}" fill="var(--tenue)" font-size="10.5" text-anchor="middle" font-family="'IBM Plex Mono',monospace">${n}</text>
        <text x="${x}" y="18" fill="var(--tenue)" font-size="9.5" text-anchor="middle" font-family="'IBM Plex Mono',monospace">${etiqueta}</text>
        ${n > dibujar ? `<text x="${x}" y="${alto / 2 + ((dibujar - 1) / 2) * 17 + 20}" fill="var(--tenue)" font-size="13" text-anchor="middle">⋮</text>` : ""}`;
    })
    .join("");
  const enlaces = capas
    .slice(0, -1)
    .map((_, c) => `<line x1="${paso * (c + 1) + 6}" y1="${alto / 2}" x2="${paso * (c + 2) - 6}" y2="${alto / 2}" stroke="var(--filo)" stroke-width="1.5"/>`)
    .join("");
  return `<svg viewBox="0 0 ${ancho} ${alto}" role="img">${enlaces}${nodos}</svg>`;
}

function barrasDeRasgos(filas, limite = 14) {
  const top = filas.slice().sort((a, b) => Math.abs(b.efecto) - Math.abs(a.efecto)).slice(0, limite);
  if (!top.length) return "";
  const tope = Math.max(...top.map((f) => Math.abs(f.efecto))) || 1;
  const altoF = 21;
  const cuerpo = top
    .map((f, i) => {
      const largo = Math.max(2, (Math.abs(f.efecto) / tope) * 300);
      return `<text x="264" y="${i * altoF + 15}" fill="var(--apagado)" font-size="11.5" text-anchor="end" font-family="'IBM Plex Mono',monospace">${esc(f.nombre)}</text>
        <rect x="272" y="${i * altoF + 6}" width="${largo.toFixed(1)}" height="11" rx="1.5" fill="${f.efecto > 0 ? "var(--bien)" : "var(--mal)"}"/>`;
    })
    .join("");
  return `<svg viewBox="0 0 700 ${top.length * altoF + 10}" role="img">${cuerpo}</svg>`;
}

// --- Montaje --------------------------------------------------------------------

function leer(nombre) {
  const f = path.join(MODELOS, nombre);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

function bloqueRed({ titulo, resumen, curva, curvaAcierto, porRonda, calib, capas, victorias, error, perdida, acierto, rasgos, rasgos2, titulo2, nota }) {
  const fichas = [
    ["victorias en juego", victorias === undefined ? "—" : `${pct(victorias)}${error ? ` <small>±${Math.round(error * 100)}</small>` : ""}`],
    ["pérdida validación", perdida === undefined ? "—" : perdida.toFixed(4)],
    ["acierto", pct(acierto)],
    ["entradas", capas ? capas[0] : "—"],
  ]
    .map(([k, v]) => `<div class="ficha"><dt>${esc(k)}</dt><dd>${v}</dd></div>`)
    .join("");

  return `<section>
    <h2>${esc(titulo)}</h2>
    <p class="sub">${resumen}</p>
    <dl class="fichas">${fichas}</dl>
    ${porRonda ? `<figure><figcaption>ENTRE RONDAS: cómo va cambiando de un entrenamiento al siguiente. Es la vista de "va mejorando" o no.</figcaption><div class="lienzo">${porRonda}</div></figure>` : ""}
    <div class="par">
      ${curva ? `<figure><figcaption>Dentro de la última ronda: pérdida. Si la de validación sube mientras la otra baja, está memorizando.</figcaption><div class="lienzo">${curva}</div></figure>` : ""}
      ${curvaAcierto ? `<figure><figcaption>Y el acierto. La distancia entre las dos líneas ES el sobreajuste: cuanto más se separan, más se ha aprendido de memoria.</figcaption><div class="lienzo">${curvaAcierto}</div></figure>` : ""}
    </div>
    <div class="par">
      ${calib ? `<figure><figcaption>Calibración: predicho contra observado. La diagonal es la perfección; el tamaño de cada bola es cuántos casos hay.</figcaption><div class="lienzo">${calib.grafico}</div></figure>` : ""}
      ${calib ? `<figure><figcaption>Distribución de lo que predice. Todo amontonado en el centro sería una red que no se moja.</figcaption><div class="lienzo">${calib.histograma}</div></figure>` : ""}
    </div>
    ${capas ? `<figure><figcaption>Arquitectura.</figcaption><div class="lienzo">${arquitectura(capas)}</div></figure>` : ""}
    ${rasgos ? `<figure><figcaption>Qué mira: efecto de cada rasgo sobre la predicción.</figcaption><div class="lienzo">${rasgos}</div></figure>` : ""}
    ${rasgos2 ? `<figure><figcaption>${esc(titulo2 || "")}</figcaption><div class="lienzo">${rasgos2}</div></figure>` : ""}
    ${nota ? `<div class="nota">${nota}</div>` : ""}
  </section>`;
}

export function construir({ despliegue, jugada, coevolucion, panel, sensibilidadDespliegue, sensibilidadJugada }) {
  const bloques = [];

  if (coevolucion && coevolucion.historia && coevolucion.historia.length > 1) {
    // La entrada "final" no es una ronda: lleva el veredicto en semillas frescas
    // y no tiene ni número de ronda ni marca de panel. Fuera de las curvas.
    const veredicto = coevolucion.historia.find((r) => r.ronda === "final");
    const h = coevolucion.historia.filter((r) => typeof r.ronda === "number");
    const ultima = h[h.length - 1];
    const adoptadas = h.filter((r) => r.adoptadas).length;
    const conTitular = h.filter((r) => r.titular !== undefined);

    const curva = lineas({
      series: [
        { nombre: "titular, remedido cada ronda", color: "var(--bien)", puntos: conTitular.map((r) => ({ x: r.ronda, y: r.titular })) },
        { nombre: "aspirante de la ronda", color: "var(--dato)", grosor: 1.5, puntos: h.filter((r) => r.medida !== undefined).map((r) => ({ x: r.ronda, y: r.medida })) },
      ],
      min: 0, max: 1, formato: (v) => `${Math.round(v * 100)}%`, etiquetaX: "ronda", alto: 190,
    });

    // La carrera: si las dos curvas suben a la vez, las dos partes están
    // aprendiendo. Si solo sube la de las formaciones, el otro corredor está
    // parado y hay que mirar por qué.
    const conFormaciones = h.filter((r) => r.formaciones);
    const carrera = conFormaciones.length > 1 ? lineas({
      series: [
        { nombre: "la formación más dura", color: "var(--mal)", puntos: conFormaciones.map((r) => ({ x: r.ronda, y: r.formaciones.masDura.aptitud })) },
        { nombre: "media de la población", color: "var(--laton)", grosor: 1.5, puntos: conFormaciones.map((r) => ({ x: r.ronda, y: r.formaciones.media })) },
        { nombre: "paridad", color: "var(--tenue)", guion: true, grosor: 1.5, puntos: conFormaciones.map((r) => ({ x: r.ronda, y: 0.5 })) },
      ],
      min: 0, max: 1, formato: (v) => `${Math.round(v * 100)}%`, etiquetaX: "ronda", alto: 190,
    }) : "";

    const fichas = [
      ["veredicto en semillas frescas", veredicto ? pct(veredicto.veredicto) : "—"],
      ["titular en la última ronda", ultima && ultima.titular !== undefined ? pct(ultima.titular) : "—"],
      ["rondas", h.length - 1],
      ["adoptadas", `${adoptadas}<small> de ${h.length - 1}</small>`],
      ["formaciones archivadas", ultima && ultima.formaciones ? ultima.formaciones.archivo : "—"],
      ["tiempo", ultima && ultima.segundos !== undefined ? `${Math.round(ultima.segundos / 60)} min` : "—"],
    ].map(([k, v]) => `<div class="ficha"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("");

    const semillas = veredicto && veredicto.semillas
      ? `<p class="sub">Veredicto medido en ${veredicto.semillas.length} juegos de partidas que ninguna ronda ha usado:
         ${veredicto.semillas.map((t) => pct(t)).join(" · ")}. El máximo de las medidas por ronda no vale como
         resumen: elegir el máximo de una tanda de medidas ruidosas sesga al alza.</p>`
      : "";

    bloques.push(`<section>
      <h2>Coevolución</h2>
      <p class="sub">Las dos redes juegan entre ellas y se reentrenan con esas partidas, contra una
      población de formaciones que evoluciona a la vez para ganarles. Se miden contra el panel de
      aperturas humanas, que no cambia: las redes pueden derivar hacia adaptarse a lo que tienen
      enfrente, y la vara externa es lo que impide confundir eso con mejorar.</p>
      <p class="sub">Cada ronda el titular vuelve a jugar, en las mismas partidas que el aspirante y
      con semillas nuevas. Conservar la nota con la que fue elegido lo hacía competir con una nota
      inflada -fue elegido justamente por tener suerte en esas partidas- y el listón se volvía
      inalcanzable: doce rondas seguidas descartadas.</p>
      <dl class="fichas">${fichas}</dl>
      ${semillas}
      ${curva ? `<figure><figcaption>Verde: el titular, remedido en partidas nuevas cada ronda. Azul: el aspirante de esa ronda.</figcaption><div class="lienzo">${curva}</div></figure>` : ""}
      ${carrera ? `<figure><figcaption>La carrera vista desde el otro lado: cuánto le sacan las formaciones a las redes. Si sube sola, el otro corredor está parado.</figcaption><div class="lienzo">${carrera}</div></figure>` : ""}
    </section>`);
  }

  if (jugada) {
    const rondas = jugada.rondas || [];
    const ultima = rondas[rondas.length - 1] || {};
    const curva = ultima.curva
      ? lineas({
          series: [
            { nombre: "entrenamiento", color: "var(--dato)", puntos: ultima.curva.map((p) => ({ x: p.epoca, y: p.entrenamiento })) },
            { nombre: "validación", color: "var(--laton)", puntos: ultima.curva.map((p) => ({ x: p.epoca, y: p.validacion })) },
          ],
          etiquetaX: "época",
        })
      : "";
    const porRonda = rondas.length > 1
      ? lineas({
          series: [{ nombre: "victorias contra la heurística", color: "var(--bien)", puntos: rondas.map((r) => ({ x: r.ronda, y: r.victoriasEnJuego })) },
                   { nombre: "paridad", color: "var(--tenue)", guion: true, grosor: 1.5, puntos: rondas.map((r) => ({ x: r.ronda, y: 0.5 })) }],
          min: 0, max: 1, formato: (v) => `${Math.round(v * 100)}%`, etiquetaX: "ronda", alto: 180,
        })
      : "";
    bloques.push(
      bloqueRed({
        titulo: "Evaluador de jugadas",
        resumen:
          "Decide qué jugada hacer. Ve la posición y la jugada en sí, y estima la probabilidad de acabar ganando. " +
          "Cada ronda genera partidas nuevas jugando con la red de la ronda anterior y reentrena desde cero.",
        curva,
        calib: ultima.calibracion ? { grafico: calibracion(ultima.calibracion), histograma: histograma(ultima.calibracion) } : null,
        capas: [jugada.red ? jugada.red.capas[0] : null, jugada.opciones ? jugada.opciones.oculta : null, 1].filter(Boolean),
        victorias: jugada.mejorVictorias !== undefined ? jugada.mejorVictorias : ultima.victoriasEnJuego,
        error: ultima.errorEnJuego,
        perdida: ultima.perdidaValidacion,
        acierto: ultima.acierto,
        curvaAcierto: ultima.curva && ultima.curva[0] && ultima.curva[0].aciertoValidacion !== undefined
          ? lineas({
              series: [
                { nombre: "entrenamiento", color: "var(--dato)", puntos: ultima.curva.map((p) => ({ x: p.epoca, y: p.aciertoEntrenamiento })) },
                { nombre: "validación", color: "var(--laton)", puntos: ultima.curva.map((p) => ({ x: p.epoca, y: p.aciertoValidacion })) },
              ],
              min: 0.5, max: 1, formato: (v) => `${Math.round(v * 100)}%`, etiquetaX: "época",
            })
          : null,
        // La sensibilidad de esta red va PARTIDA en dos, y la separación dice
        // algo: los rasgos de posición pesan un orden de magnitud más que los de
        // jugada, o sea que la red valora sobre todo DÓNDE se está y no tanto
        // QUÉ se hace. Eso explica por qué le cuesta distinguir entre jugadas de
        // una misma posición, que es justo lo que se le pide.
        rasgos: sensibilidadJugada
          ? barrasDeRasgos(sensibilidadJugada.filter((r) => r.nombre.startsWith("jugada")).map((r) => ({ ...r, nombre: r.nombre.replace("jugada · ", "") })))
          : null,
        rasgos2: sensibilidadJugada
          ? barrasDeRasgos(sensibilidadJugada.filter((r) => r.nombre.startsWith("posición")).map((r) => ({ ...r, nombre: r.nombre.replace("posición · ", "") })))
          : null,
        titulo2: "Y qué mira de la POSICIÓN. Si estas barras son mucho más largas que las de arriba, la red está juzgando dónde se está más que qué se hace.",
        nota: porRonda
          ? `<h3>Progreso por ronda</h3><p>Si la iteración funciona, esta línea sube. Si se queda plana, la red imita a su maestro y no lo supera.</p><div class="lienzo">${porRonda}</div>`
          : "",
      })
    );
  }

  if (despliegue) {
    bloques.push(
      bloqueRed({
        titulo: "Red de la posición de salida",
        resumen:
          "Juzga un despliegue inicial antes de empezar. Al desplegar se generan cuarenta candidatos al azar y se " +
          "elige el que mejor puntúa. Es el modelo que más gana de los dos.",
        curva: despliegue.curva
          ? lineas({
              series: [
                { nombre: "entrenamiento", color: "var(--dato)", puntos: despliegue.curva.map((p) => ({ x: p.epoca, y: p.entrenamiento })) },
                { nombre: "validación", color: "var(--laton)", puntos: despliegue.curva.map((p) => ({ x: p.epoca, y: p.validacion })) },
              ],
              etiquetaX: "época",
            })
          : "",
        calib: null,
        capas: despliegue.red ? despliegue.red.capas : null,
        victorias: despliegue.victoriasEnJuego,
        perdida: despliegue.perdidaValidacion,
        rasgos: sensibilidadDespliegue ? barrasDeRasgos(sensibilidadDespliegue) : null,
        nota:
          "<p><b>Un aviso sobre la pérdida:</b> apenas se despega de 0,693, que es adivinar a ciegas, y aun así en " +
          "juego gana el 75%. No es contradictorio: el resultado de una partida depende de los cuatro despliegues y " +
          "de todo lo jugado después, así que casi toda la varianza es irreducible. La red tiene una señal débil pero " +
          "bien ordenada, y elegir el mejor de cuarenta candidatos la amplifica.</p>",
      })
    );
  }

  // El charset es obligatorio: servido como fichero suelto en GitHub Pages, sin
  // esta línea el navegador asume Latin-1 y todos los acentos salen rotos.
  if (panel && panel.resultados && panel.resultados.length) {
    // El desglose importa tanto como la media: una red puede ir muy bien de
    // promedio y perder siempre contra una apertura concreta, y eso es un
    // agujero, no una estadística.
    const mejor = panel.resultados.reduce((m, r) => (r.tasa > m.tasa ? r : m), panel.resultados[0]);
    const orden = mejor.porRival.slice().sort((a, b) => a.tasa - b.tasa);
    const filas = orden.map((r) => {
      const ancho = Math.max(1, Math.round(r.tasa * 100));
      return `<div class="rival">
        <span class="nombre">${esc(r.rival)}</span>
        <span class="clase">${esc(r.clase)}</span>
        <span class="barra"><i style="width:${ancho}%"></i></span>
        <span class="cifra">${Math.round(r.tasa * 100)}%</span>
      </div>`;
    }).join("");
    bloques.push(`<section>
      <h2>Rival a rival</h2>
      <p class="sub">Contra el panel de aperturas, que no cambia nunca. La media esconde lo que
        importa: una red puede ir bien de promedio y perder siempre contra una apertura concreta,
        y eso es un agujero. Ordenado de peor a mejor.</p>
      <div class="rivales">${filas}</div>
    </section>`);
  }

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Redes de Reuter4</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600&family=Spectral:wght@300;400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
 :root{--suelo:#EDE4D2;--tabla:#F8F3E7;--tinta:#2B2118;--apagado:#6E6045;--tenue:#8C7C5E;--laton:#8A6420;
  --filo:#CDBE9F;--bien:#4B7B3C;--mal:#A8452F;--dato:#2F6B8A}
 @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--suelo:#1E1710;--tabla:#2B2118;--tinta:#EDE3CC;
  --apagado:#B0A183;--tenue:#8C7F64;--laton:#D9A94C;--filo:#4A3D2B;--bien:#7FB069;--mal:#C97A6A;--dato:#6FA8C7}}
 :root[data-theme="dark"]{--suelo:#1E1710;--tabla:#2B2118;--tinta:#EDE3CC;--apagado:#B0A183;--tenue:#8C7F64;
  --laton:#D9A94C;--filo:#4A3D2B;--bien:#7FB069;--mal:#C97A6A;--dato:#6FA8C7}
 *{box-sizing:border-box}
 body{margin:0;background:var(--suelo);color:var(--tinta);font:400 16.5px/1.65 Spectral,Georgia,serif}
 .hoja{max-width:860px;margin:0 auto;padding:52px 24px 90px}
 .cintillo{font:500 11.5px/1 "IBM Plex Mono",monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--laton)}
 h1{font:600 clamp(36px,7vw,54px)/1.05 "Cormorant Garamond",Georgia,serif;margin:14px 0 0;text-wrap:balance}
 .entradilla{font-size:18.5px;color:var(--apagado);margin:14px 0 26px;max-width:62ch;font-weight:300}
 .entradilla b{color:var(--tinta);font-weight:600}
 section{background:var(--tabla);border:1px solid var(--filo);border-radius:4px;padding:22px 24px 8px;margin-bottom:24px}
 h2{font:600 26px/1.2 "Cormorant Garamond",Georgia,serif;margin:0 0 6px}
 h3{font:600 18px/1.3 "Cormorant Garamond",Georgia,serif;margin:22px 0 4px;color:var(--laton)}
 .sub{color:var(--tenue);font-size:14.5px;margin:0 0 18px;max-width:64ch}
 .fichas{display:grid;grid-template-columns:repeat(auto-fit,minmax(126px,1fr));gap:9px;margin:0 0 20px;padding:0}
 .ficha{background:var(--suelo);border:1px solid var(--filo);border-radius:3px;padding:10px 12px}
 .ficha dt{font:500 10px/1.3 "IBM Plex Mono",monospace;letter-spacing:.09em;text-transform:uppercase;color:var(--tenue)}
 .ficha dd{margin:5px 0 0;font:500 23px/1 "IBM Plex Mono",monospace;font-variant-numeric:tabular-nums}
 .ficha dd small{font-size:12px;color:var(--apagado)}
 figure{margin:0 0 18px}
 figcaption{font-size:13px;color:var(--tenue);margin-bottom:7px;max-width:64ch}
 .lienzo{background:var(--suelo);border:1px solid var(--filo);border-radius:3px;padding:10px;overflow-x:auto}
 svg{display:block;width:100%;height:auto}
 .par{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
 .nota{border-top:1px solid var(--filo);padding-top:14px;margin-bottom:14px;color:var(--apagado);font-size:15.5px}
 .nota p{margin:0 0 8px} .nota b{color:var(--tinta)}
 footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--filo);font:400 13px/1.7 "IBM Plex Mono",monospace;color:var(--tenue)}
 a{color:var(--laton)}
  .rivales { display:flex; flex-direction:column; gap:4px; }
  .rival { display:grid; grid-template-columns:140px 74px 1fr 44px; gap:10px; align-items:center; font-size:13px; }
  .rival .nombre { font-weight:600; }
  .rival .clase { color:var(--tenue); font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  .rival .barra { background:var(--linea); border-radius:5px; height:9px; overflow:hidden; }
  .rival .barra i { display:block; height:100%; background:var(--bien); }
  .rival .cifra { text-align:right; font-variant-numeric:tabular-nums; color:var(--tenue); }
</style>
</head><body>
<div class="hoja">
<p class="cintillo">Reuter4 · modelos de los bots</p>
<h1>Redes de Reuter4</h1>
<p class="entradilla">Dos redes, entrenadas jugando contra sí mismas sin ninguna ayuda humana de partida.
Una elige la posición inicial y otra decide cada jugada. <b>La medida que manda es la última:
victorias contra la heurística escrita a mano</b>; lo demás es diagnóstico.</p>
${bloques.join("")}
<footer>Generado el ${esc(new Date().toLocaleString("es-ES"))} · <a href="https://github.com/grutino/reuter4">github.com/grutino/reuter4</a><br>
Motor propio sin dependencias. La red se entrena y se ejecuta en JavaScript.</footer>
</div>
</body></html>`;
}

// Rehace el informe leyendo lo que haya en modelos/. La llama tanto el guion
// suelto como el bucle de coevolución después de cada ronda.
// Las dos sensibilidades, con el mismo módulo y cada una sobre SUS vectores: los
// de despliegue salen de posiciones iniciales y los de jugada de jugadas
// concretas en partidas en curso. Es accesoria: si falla, el informe sigue.
async function calcularSensibilidades(despliegue, jugada) {
  const salida = { sensibilidadDespliegue: null, sensibilidadJugada: null };
  try {
    const { sensibilidadDeDespliegue, sensibilidadDeJugada } = await import("./sensibilidad.mjs");
    const { desdeObjeto } = await import("../src/motor/red.js");
    if (despliegue && despliegue.red) {
      salida.sensibilidadDespliegue = sensibilidadDeDespliegue(desdeObjeto(despliegue.red), { muestras: 200 })
        .map((r) => ({ nombre: r.nombre.replace(" · ", " "), efecto: r.efecto }));
    }
    if (jugada && jugada.red) {
      salida.sensibilidadJugada = sensibilidadDeJugada(desdeObjeto(jugada.red), { partidas: 14 })
        .map((r) => ({ nombre: r.nombre, efecto: r.efecto }));
    }
  } catch {
    // accesoria
  }
  return salida;
}

export async function generarInforme() {
  const despliegue = leer("red-despliegue.json");
  const jugada = leer("red-jugada.json");
  const coevolucion = leer("coevolucion.json");
  const panel = leer("panel.json");
  const { sensibilidadDespliegue, sensibilidadJugada } = await calcularSensibilidades(despliegue, jugada);
  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  fs.writeFileSync(DESTINO, construir({ despliegue, jugada, coevolucion, panel, sensibilidadDespliegue, sensibilidadJugada }));
  return DESTINO;
}

if (process.argv[1] && process.argv[1].endsWith("informe-redes.mjs")) {
  console.log("Informe escrito en", path.relative(process.cwd(), await generarInforme()));
}
