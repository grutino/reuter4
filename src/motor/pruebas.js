import assert from "node:assert";
import {
  CASILLAS,
  COLORES,
  ADYACENTES,
  ACCESOS_CASTILLO,
  ANILLO,
  TORRE,
  ZONAS,
  casillasDeZona,
} from "./tablero.js";
import {
  nuevaPartida,
  validarDespliegue,
  movimientosLegales,
  aplicar,
  reclutar,
  recogerLaBandera,
  renunciarARecoger,
  inventarioInicial,
  vistaDe,
  MAX_ALTERNANCIAS,
  MAX_HISTORIA,
  resolverDuelo,
} from "./motor.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { accionDeBot, accionDeBotClasico, decisionDeRecogida, despliegueAleatorio, DISTANCIA, PESOS_BASE } from "./bot.js";
import { peligroEn, lineasAbiertasSi } from "./analisis.js";
import { analizarTurno } from "./analisis.js";
import { rasgosDeJugada, contextoDeTurno, NOMBRES as NOMBRES_RASGOS, TAMANO as TAMANO_JUGADA, FIRMA as FIRMA_JUGADA } from "./rasgos-jugada.js";
import { jugadaDeBot, jugadaSoloRed } from "./bot-red.js";
import { cargarModelos } from "./modelos.js";
import { ACTIVACION } from "./red.js";
import { COMO_JUEGAN, configuracionDeBot } from "./dificultad.js";
import { BATEN_ANILLO, BATEN_LA_TORRE, PASOS_A_TIRO, ANILLO as ANILLO_T } from "./tablero.js";
import { salaParaJugador } from "../../servidor/vista.mjs";
import { centro as centroEnInforme, reconstruirRangos, CELDA, MARGEN, LADO } from "../informe-partida.js";
import { vistaDelEscenario } from "../escenario-vista.js";
import { reproducirPartida, ReplayImposible } from "./replay.js";
import { crearRed, evaluar, adelante } from "./red.js";
import { entrenarPares } from "../../entrenamiento/red.mjs";
import { propiedadesDePieza, FIRMA as FIRMA_DESPLIEGUE } from "./rasgos-despliegue.js";

let pasadas = 0;
let fallidas = 0;
function prueba(nombre, fn) {
  try {
    fn();
    pasadas++;
    console.log(`  ok  ${nombre}`);
  } catch (e) {
    fallidas++;
    console.log(`FALLA  ${nombre}\n       ${e.message}`);
  }
}

// --- Utilidades de escenario ------------------------------------------------

function estadoVacio() {
  return {
    modo: "equipos",
    orden: ["rojo", "verde", "verde", "amarillo"],
    turno: "rojo",
    piezas: {},
    tablero: {},
    banderas: {},
    banderasSueltas: {},
    marcador: { rojo: 0, verde: 0, azul: 0, amarillo: 0 },
    bajas: { rojo: [], verde: [], azul: [], amarillo: [] },
    pendiente: null,
    fin: null,
    eventos: [],
    contador: 0,
  };
}

function colocar(estado, color, rango, casilla, opciones = {}) {
  const id = `${color}-${++estado.contador}`;
  estado.piezas[id] = {
    id,
    color,
    rango,
    casilla,
    bandera: opciones.bandera ? color : null,
    alternancias: 0,
    ultimoTramo: null,
  };
  estado.tablero[casilla] = id;
  if (opciones.bandera) {
    estado.banderas[color] = { portador: id, casilla: null, ultimoDueño: color };
  }
  return estado.piezas[id];
}

function despliegueEstandar(color) {
  const casillas = casillasDeZona(color).filter((c) => c !== ZONAS[color].reclutamiento);
  const rangos = inventarioInicial();
  const banderaCasilla = ZONAS[color].bandera;
  return casillas.map((casilla, i) => ({
    casilla,
    rango: rangos[i],
    bandera: casilla === banderaCasilla,
  }));
}

function partidaCompleta() {
  return nuevaPartida({
    rojo: despliegueEstandar("rojo"),
    verde: despliegueEstandar("verde"),
    azul: despliegueEstandar("azul"),
    amarillo: despliegueEstandar("amarillo"),
  });
}

function accion(acciones, filtro) {
  const encontrada = acciones.find(filtro);
  assert.ok(encontrada, "no se ha generado la acción esperada");
  return encontrada;
}

console.log("\nGEOMETRÍA");

prueba("144 casillas de rejilla más anillo y torre", () => {
  assert.strictEqual(CASILLAS.length, 146);
  assert.ok(CASILLAS.includes(ANILLO) && CASILLAS.includes(TORRE));
});

prueba("el castillo tiene exactamente 12 accesos", () => {
  assert.strictEqual(ACCESOS_CASTILLO.size, 12);
  for (const c of ["F7", "F8", "F9", "J7", "J8", "J9", "G6", "H6", "I6", "G10", "H10", "I10"]) {
    assert.ok(ACCESOS_CASTILLO.has(c), `falta ${c}`);
  }
});

prueba("la torre solo conecta con el anillo", () => {
  assert.deepStrictEqual(ADYACENTES[TORRE], [ANILLO]);
  assert.strictEqual(ADYACENTES[ANILLO].length, 13);
});

prueba("el bosque y los lagos no son casillas", () => {
  assert.ok(!CASILLAS.includes("A1"));
  assert.ok(!CASILLAS.includes("O15"));
  assert.ok(!CASILLAS.includes("H5"));
  assert.ok(!CASILLAS.includes("E8"));
});

console.log("\nDESPLIEGUE");

prueba("el despliegue estándar es válido para los cuatro colores", () => {
  for (const color of ["rojo", "verde", "verde", "amarillo"]) {
    assert.deepStrictEqual(validarDespliegue(color, despliegueEstandar(color)), []);
  }
});

prueba("ocupar la casilla de reclutamiento invalida el despliegue", () => {
  const d = despliegueEstandar("rojo");
  d[0].casilla = "H2";
  const errores = validarDespliegue("rojo", d);
  assert.ok(errores.some((e) => e.includes("reclutamiento")));
});

prueba("la bandera debe salir de su casilla marcada", () => {
  const d = despliegueEstandar("rojo").map((p) => ({ ...p, bandera: false }));
  d[0].bandera = true;
  const errores = validarDespliegue("rojo", d);
  assert.ok(errores.some((e) => e.includes("H1")));
});

prueba("una partida completa arranca con 80 piezas y turno de rojo", () => {
  const e = partidaCompleta();
  assert.strictEqual(Object.keys(e.piezas).length, 80);
  assert.strictEqual(e.turno, "rojo");
  assert.strictEqual(movimientosLegales(e).length > 0, true);
});

console.log("\nMOVIMIENTO");

prueba("el capitán llega a dos casillas con giro", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 6, "H4");
  const m = movimientosLegales(e);
  assert.ok(m.some((a) => a.hasta === "J4" && a.via === "I4"));
  assert.ok(m.some((a) => a.hasta === "I3" && a.via));
  assert.ok(!m.some((a) => a.hasta === "H4"));
});

prueba("el capitán que ataca en la primera casilla no sigue avanzando", () => {
  const e = estadoVacio();
  const cap = colocar(e, "rojo", 6, "H4");
  colocar(e, "verde", 5, "I4");
  const m = movimientosLegales(e);
  const ataque = accion(m, (a) => a.tipo === "atacar" && a.hasta === "I4");
  assert.strictEqual(ataque.via, undefined);
  const despues = aplicar(e, ataque);
  assert.strictEqual(despues.piezas[cap.id].casilla, "I4");
});

prueba("el explorador recorre la recta y se detiene ante el castillo", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 3, "F11");
  const destinos = movimientosLegales(e)
    .filter((a) => a.desde === "F11" && ["F10", "F9", "F8", "F7", "F6"].includes(a.hasta))
    .map((a) => a.hasta);
  assert.ok(["F10", "F9", "F8", "F7"].every((c) => destinos.includes(c)));
  assert.ok(!movimientosLegales(e).some((a) => a.hasta === TORRE));
});

prueba("el explorador no cruza un lago", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 3, "H4");
  const m = movimientosLegales(e);
  assert.ok(!m.some((a) => a.hasta === "H6"), "no debería pasar por encima de H5");
});

prueba("el portador de bandera solo avanza una casilla", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 3, "F11", { bandera: true });
  const m = movimientosLegales(e);
  assert.ok(m.some((a) => a.hasta === "F10"));
  assert.ok(!m.some((a) => a.hasta === "F9"));
});

console.log("\nDUELOS");

prueba("el espía gana al mariscal solo si ataca él", () => {
  const e = estadoVacio();
  const espia = colocar(e, "rojo", 2, "H4");
  colocar(e, "verde", 9, "G4");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar"));
  assert.strictEqual(tras.eventos[0].resultado, "atacante");
  assert.ok(tras.piezas[espia.id]);
  assert.strictEqual(tras.piezas[espia.id].casilla, "G4");
});

prueba("el mariscal gana si es él quien ataca al espía", () => {
  const e = estadoVacio();
  e.turno = "verde";
  colocar(e, "rojo", 2, "H4");
  const mariscal = colocar(e, "verde", 9, "G4");
  const tras = aplicar(e, accion(movimientosLegales(e, "verde"), (a) => a.tipo === "atacar"));
  assert.strictEqual(tras.eventos[0].resultado, "atacante");
  assert.strictEqual(tras.piezas[mariscal.id].casilla, "H4");
});

prueba("mismo rango: caen las dos y nadie avanza el marcador", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 7, "H4");
  colocar(e, "verde", 7, "G4");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar"));
  assert.strictEqual(Object.keys(tras.piezas).length, 0);
  assert.strictEqual(tras.marcador.rojo, 0);
  assert.strictEqual(tras.marcador.verde, 0);
});

prueba("el defensor que gana también avanza su marcador", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 4, "H4");
  colocar(e, "verde", 8, "G4");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar"));
  assert.strictEqual(tras.marcador.verde, 1);
  assert.strictEqual(tras.marcador.rojo, 0);
});

console.log("\nCAÑÓN");

prueba("el cañón dispara a 1, 2 y 3 casillas", () => {
  for (const [destino, distancia] of [["I4", 1], ["J4", 2], ["K4", 3]]) {
    const e = estadoVacio();
    colocar(e, "rojo", 1, "H4");
    colocar(e, "verde", 9, destino);
    assert.ok(
      movimientosLegales(e).some((a) => a.tipo === "disparar" && a.hasta === destino),
      `debería alcanzar a distancia ${distancia}`
    );
  }
  const lejos = estadoVacio();
  colocar(lejos, "rojo", 1, "H4");
  colocar(lejos, "verde", 9, "L4");
  assert.ok(!movimientosLegales(lejos).some((a) => a.tipo === "disparar"), "a cuatro casillas no llega");
});

prueba("la bala sobrevuela el lago y bate el anillo a tres casillas", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 1, "D8"); // D8 - E8 (lago) - F8 - anillo
  colocar(e, "verde", 9, ANILLO);
  assert.ok(movimientosLegales(e).some((a) => a.tipo === "disparar" && a.hasta === ANILLO));
});

prueba("una pieza en medio corta la línea de tiro", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 1, "D8");
  colocar(e, "rojo", 4, "F8"); // pieza propia bloqueando
  colocar(e, "verde", 9, ANILLO);
  assert.ok(!movimientosLegales(e).some((a) => a.tipo === "disparar"));
});

prueba("el cañón bate al primero de la línea, no al que elija", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 1, "D8");
  colocar(e, "verde", 3, "F8");
  colocar(e, "verde", 9, ANILLO);
  const disparos = movimientosLegales(e).filter((a) => a.tipo === "disparar");
  assert.strictEqual(disparos.length, 1);
  assert.strictEqual(disparos[0].hasta, "F8");
});

prueba("tras el cañonazo se retiran los dos y el marcador sube", () => {
  const e = estadoVacio();
  const canon = colocar(e, "rojo", 1, "D8");
  const objetivo = colocar(e, "verde", 9, "F8");
  colocar(e, "rojo", 4, "D9");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "disparar"));
  assert.ok(!tras.piezas[canon.id], "el cañón debe retirarse");
  assert.ok(!tras.piezas[objetivo.id], "el objetivo debe retirarse");
  assert.strictEqual(tras.marcador.rojo, 1);
});

prueba("el cañón no ataca cuerpo a cuerpo: siempre es disparo", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 1, "H4");
  colocar(e, "verde", 9, "H3");
  const m = movimientosLegales(e);
  assert.ok(!m.some((a) => a.tipo === "atacar"));
  assert.ok(m.some((a) => a.tipo === "disparar" && a.hasta === "H3"));
});

prueba("el cañón pierde siempre defendiendo, incluso ante un explorador", () => {
  const e = estadoVacio();
  e.turno = "verde";
  const canon = colocar(e, "rojo", 1, "G4");
  const explorador = colocar(e, "verde", 3, "D4");
  const ataque = accion(
    movimientosLegales(e, "verde"),
    (a) => a.tipo === "atacar" && a.pieza === explorador.id && a.hasta === "G4"
  );
  const tras = aplicar(e, ataque);
  assert.strictEqual(tras.eventos[0].resultado, "atacante");
  assert.ok(!tras.piezas[canon.id]);
  assert.strictEqual(tras.marcador.verde, 1);
});

console.log("\nBANDERA Y CASTILLO");

prueba("la bandera queda suelta tras un empate y la recoge un tercero", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 7, "H4", { bandera: true });
  colocar(e, "verde", 7, "G4");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar"));
  assert.strictEqual(tras.banderasSueltas["H4"] && tras.banderasSueltas["H4"][0], "rojo");

  // tras el empate no quedaba nadie en el tablero, así que la partida se había dado por cerrada
  const e2 = { ...tras, turno: "verde", fin: null };
  colocar(e2, "verde", 5, "H3");
  const recoge = accion(movimientosLegales(e2, "verde"), (a) => a.hasta === "H4");
  const tras2 = aplicar({ ...e2, turno: "verde" }, recoge);
  assert.strictEqual(tras2.pendiente.tipo, "recoger", "pisar la bandera solo abre la decisión");
  const tras3 = recogerLaBandera(tras2);
  const portador = Object.values(tras3.piezas).find((p) => p.bandera === "rojo");
  assert.ok(portador, "alguien debe llevar ahora la bandera roja");
  assert.strictEqual(portador.color, "verde");
});

prueba("capturar la bandera de su dueño abre reclutamiento", () => {
  const e = estadoVacio();
  colocar(e, "verde", 4, "G4", { bandera: true });
  colocar(e, "rojo", 9, "H4");
  e.bajas.rojo.push(5);
  const tras = recogerLaBandera(aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar")));
  assert.ok(tras.pendiente, "debería abrirse un reclutamiento");
  assert.strictEqual(tras.pendiente.tipo, "reclutar");
  assert.strictEqual(tras.pendiente.color, "rojo");
});

prueba("se puede ocupar la torre sin bandera y es atacable desde el anillo", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 9, TORRE);
  e.turno = "verde";
  colocar(e, "verde", 4, ANILLO);
  const m = movimientosLegales(e, "verde");
  assert.ok(m.some((a) => a.tipo === "atacar" && a.hasta === TORRE));
});

prueba("llegar a la torre con la bandera propia gana la partida", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 4, ANILLO, { bandera: true });
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === TORRE));
  assert.ok(tras.fin);
  assert.strictEqual(tras.fin.ganador, "rojo");
});

prueba("llegar a la torre con la bandera de otro no gana", () => {
  const e = estadoVacio();
  const pieza = colocar(e, "rojo", 4, ANILLO);
  pieza.bandera = "verde";
  e.banderas.azul = { portador: pieza.id, casilla: null, ultimoDueño: "rojo" };
  colocar(e, "rojo", 5, "H6");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === TORRE));
  assert.strictEqual(tras.fin, null);
});

console.log("\nRECLUTAMIENTO");

prueba("seis victorias abren el reclutamiento", () => {
  const e = estadoVacio();
  e.marcador.rojo = 5;
  e.bajas.rojo.push(9, 3);
  colocar(e, "rojo", 8, "H4");
  colocar(e, "verde", 4, "G4");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar"));
  assert.ok(tras.pendiente);
  assert.deepStrictEqual(tras.pendiente.opciones, [9, 3]);
  assert.strictEqual(tras.marcador.rojo, 0);
});

prueba("el reclutamiento falla si la casilla está ocupada", () => {
  const e = estadoVacio();
  e.marcador.rojo = 5;
  e.bajas.rojo.push(9);
  colocar(e, "rojo", 8, "H4");
  colocar(e, "rojo", 5, "H2"); // casilla de reclutamiento ocupada
  colocar(e, "verde", 4, "G4");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar"));
  assert.strictEqual(tras.pendiente, null);
  assert.strictEqual(tras.marcador.rojo, 0);
  assert.ok(tras.eventos.some((ev) => ev.tipo === "reclutamiento-fallido"));
});

prueba("la pieza reclutada entra sin publicar su rango", () => {
  const e = estadoVacio();
  e.marcador.rojo = 5;
  e.bajas.rojo.push(9);
  colocar(e, "rojo", 8, "H4");
  colocar(e, "verde", 4, "G4");
  const conPendiente = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar"));
  const tras = reclutar(conPendiente, 9);
  assert.strictEqual(tras.piezas[tras.tablero["H2"]].rango, 9);
  assert.deepStrictEqual(tras.eventos[0], { tipo: "reclutamiento", color: "rojo" });
  assert.ok(!tras.eventos.some((ev) => "rango" in ev), "el rango reclutado no se publica");
  assert.strictEqual(tras.bajas.rojo.length, 0);
});


console.log("\nEQUIPOS");

prueba("no se puede atacar a una pieza del compañero", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 9, "H4");
  colocar(e, "azul", 4, "G4"); // azul es el compañero de rojo
  const m = movimientosLegales(e);
  assert.ok(!m.some((a) => a.tipo === "atacar"), "no debería haber ataque contra el compañero");
  assert.ok(!m.some((a) => a.hasta === "G4"), "tampoco se puede ocupar su casilla");
});

prueba("el cañón tampoco dispara al compañero", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 1, "H4");
  colocar(e, "azul", 9, "J4");
  assert.ok(!movimientosLegales(e).some((a) => a.tipo === "disparar"));
});

prueba("recoger la bandera del compañero no da promoción", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 4, "H4");
  e.banderasSueltas["G4"] = ["azul"];
  e.banderas.azul = { portador: null, casilla: "G4", ultimoDueño: "azul" };
  e.bajas.rojo.push(9);
  const tras = recogerLaBandera(aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === "G4")));
  const portador = Object.values(tras.piezas).find((p) => p.bandera === "azul");
  assert.ok(portador, "la bandera del compañero sí se puede recoger");
  assert.strictEqual(tras.pendiente, null, "pero no abre reclutamiento");
});

prueba("recoger del suelo la bandera enemiga sí da promoción", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 4, "H4");
  e.banderasSueltas["G4"] = ["verde"];
  e.banderas.verde = { portador: null, casilla: "G4", ultimoDueño: "verde" };
  e.bajas.rojo.push(9);
  const tras = recogerLaBandera(aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === "G4")));
  assert.ok(tras.pendiente, "debería abrirse el reclutamiento");
  assert.strictEqual(tras.pendiente.tipo, "reclutar");
  assert.strictEqual(tras.pendiente.color, "rojo");
});

prueba("recuperar tu propia bandera no da promoción", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 4, "H4");
  e.banderasSueltas["G4"] = ["rojo"];
  e.banderas.rojo = { portador: null, casilla: "G4", ultimoDueño: "rojo" };
  e.bajas.rojo.push(9);
  const tras = recogerLaBandera(aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === "G4")));
  assert.strictEqual(tras.pendiente, null);
});

prueba("una bandera solo la corona una pieza de su propio color", () => {
  // Con la bandera del compañero se puede subir a la torre, pero no se gana: la
  // partida sigue y lo único que consigues es ocupar el sitio. Esta prueba
  // afirmaba lo contrario, porque el motor aceptaba cualquier bandera aliada.
  const e = estadoVacio();
  const pieza = colocar(e, "rojo", 4, ANILLO);
  pieza.bandera = "azul";
  e.banderas.azul = { portador: pieza.id, casilla: null, ultimoDueño: "azul" };
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === TORRE));
  assert.strictEqual(tras.fin, null, "subir con la bandera de otro color no termina la partida");
  assert.strictEqual(tras.piezas[pieza.id].casilla, TORRE, "pero sí se sube y se queda ahí");
});

prueba("coronar la propia bandera gana para los dos del equipo", () => {
  const e = estadoVacio();
  e.turno = "azul";
  const pieza = colocar(e, "azul", 4, ANILLO);
  pieza.bandera = "azul";
  e.banderas.azul = { portador: pieza.id, casilla: null, ultimoDueño: "azul" };
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === TORRE));
  assert.ok(tras.fin, "con su propia bandera sí corona");
  assert.strictEqual(tras.fin.ganador, "azul");
  assert.deepStrictEqual(tras.fin.equipo.sort(), ["azul", "rojo"], "y gana la pareja entera");
});

prueba("el compañero tampoco ve tus rangos", () => {
  const e = partidaCompleta();
  const vista = vistaDe(e, "rojo");
  assert.ok(vista.piezas.filter((p) => p.color === "azul").every((p) => p.rango === null));
  assert.deepStrictEqual(vista.equipo.sort(), ["azul", "rojo"]);
});

prueba("la promoción por bandera no toca el contador de victorias", () => {
  const e = estadoVacio();
  e.marcador.rojo = 4;
  colocar(e, "rojo", 4, "H4");
  e.banderasSueltas["G4"] = ["verde"];
  e.banderas.verde = { portador: null, casilla: "G4", ultimoDueño: "verde" };
  e.bajas.rojo.push(9);
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === "G4"));
  assert.ok(tras.pendiente);
  assert.strictEqual(tras.marcador.rojo, 4, "el contador se queda como estaba");
});

prueba("la promoción por victorias sí reinicia el contador", () => {
  const e = estadoVacio();
  e.marcador.rojo = 5;
  e.bajas.rojo.push(9);
  colocar(e, "rojo", 8, "H4");
  colocar(e, "verde", 4, "G4");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar"));
  assert.strictEqual(tras.marcador.rojo, 0);
});

prueba("el cañón puede disparar aunque lleve la bandera", () => {
  // Es una jugada real de mesa: el portador dispara al que se le acerca, se
  // retira y suelta la bandera donde estaba. Cambia una pieza de rango 1 por
  // una alta y da un vuelco a la partida, así que el motor tiene que
  // permitirla aunque el portador esté limitado a un paso por turno.
  const e = estadoVacio();
  const canon = colocar(e, "rojo", 1, "H6", { bandera: true });
  colocar(e, "verde", 9, "H4");
  const disparo = accion(movimientosLegales(e), (a) => a.tipo === "disparar");
  const tras = aplicar(e, disparo);
  assert.ok(!tras.piezas[canon.id], "el cañón se retira tras disparar");
  assert.strictEqual(tras.banderasSueltas["H6"] && tras.banderasSueltas["H6"][0], "rojo", "la bandera queda donde estaba el cañón");
  assert.strictEqual(tras.marcador.rojo, 1, "el cañonazo cuenta como victoria");
});

console.log("\nRECOGER BANDERA");

prueba("caer sobre una bandera suelta solo abre la decisión", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 4, "H4");
  e.banderasSueltas["G4"] = ["verde"];
  e.banderas.verde = { portador: null, casilla: "G4", ultimoDueño: "verde" };
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === "G4"));
  assert.strictEqual(tras.pendiente.tipo, "recoger");
  assert.strictEqual(tras.pendiente.color, "rojo");
  assert.strictEqual(tras.pendiente.bandera, "verde");
  assert.strictEqual(tras.banderasSueltas["G4"] && tras.banderasSueltas["G4"][0], "verde", "todavía no la ha cogido");
  assert.strictEqual(tras.turno, "rojo", "el turno no pasa hasta decidir");
});

prueba("renunciar deja la bandera en el suelo y pasa turno", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 4, "H4");
  colocar(e, "verde", 4, "M8");
  e.banderasSueltas["G4"] = ["verde"];
  e.banderas.verde = { portador: null, casilla: "G4", ultimoDueño: "verde" };
  const tras = renunciarARecoger(aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === "G4")));
  assert.strictEqual(tras.pendiente, null);
  assert.strictEqual(tras.banderasSueltas["G4"] && tras.banderasSueltas["G4"][0], "verde");
  assert.ok(Object.values(tras.piezas).every((p) => p.bandera === null), "nadie la lleva");
  assert.notStrictEqual(tras.turno, "rojo", "tras decidir, el turno avanza");
});

prueba("renunciar a una bandera enemiga no da promoción", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 4, "H4");
  colocar(e, "verde", 4, "M8");
  e.banderasSueltas["G4"] = ["verde"];
  e.banderas.verde = { portador: null, casilla: "G4", ultimoDueño: "verde" };
  e.bajas.rojo.push(9);
  const tras = renunciarARecoger(aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === "G4")));
  assert.strictEqual(tras.pendiente, null, "sin recogida no hay promoción");
  assert.strictEqual(tras.banderas.verde.ultimoDueño, "verde", "la bandera no cambia de mano");
});

prueba("recoger la bandera propia en la torre gana la partida", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 4, ANILLO);
  e.banderasSueltas[TORRE] = ["rojo"];
  e.banderas.rojo = { portador: null, casilla: TORRE, ultimoDueño: "rojo" };
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === TORRE));
  assert.strictEqual(tras.pendiente.tipo, "recoger");
  assert.ok(!tras.fin, "coronar exige recogerla de verdad");
  const fin = recogerLaBandera(tras);
  assert.ok(fin.fin, "al recogerla en la torre, gana");
  assert.strictEqual(fin.fin.ganador, "rojo");
});

prueba("renunciar en la torre no gana", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 4, ANILLO);
  colocar(e, "verde", 4, "M8");
  e.banderasSueltas[TORRE] = ["rojo"];
  e.banderas.rojo = { portador: null, casilla: TORRE, ultimoDueño: "rojo" };
  const tras = renunciarARecoger(aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === TORRE)));
  assert.strictEqual(tras.fin, null);
  assert.deepStrictEqual(tras.banderasSueltas[TORRE], ["rojo"]);
});

prueba("quien ya lleva bandera no recibe la oferta", () => {
  const e = estadoVacio();
  const rojo = colocar(e, "rojo", 9, "H4");
  rojo.bandera = "rojo";
  e.banderas.rojo = { portador: rojo.id, casilla: null, ultimoDueño: "rojo" };
  colocar(e, "verde", 4, "G4", { bandera: true });
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar"));
  assert.strictEqual(tras.pendiente, null, "no puede llevar dos banderas");
  assert.strictEqual(tras.banderasSueltas["G4"] && tras.banderasSueltas["G4"][0], "verde", "la del caído se queda en el suelo");
  assert.ok(tras.eventos.some((ev) => ev.tipo === "bandera-en-el-suelo"));
});

prueba("la recogida se decide antes que el reclutamiento por marcador", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 9, "H4");
  colocar(e, "verde", 4, "G4", { bandera: true });
  colocar(e, "verde", 4, "M8"); // para que quede alguien a quien pasarle el turno
  e.marcador.rojo = 5; // este duelo hace la sexta victoria
  e.bajas.rojo.push(7);
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar"));
  assert.strictEqual(tras.pendiente.tipo, "recoger", "primero se decide la bandera");
  const luego = recogerLaBandera(tras);
  assert.strictEqual(luego.pendiente.tipo, "reclutar", "y después llega el reclutamiento");
  assert.strictEqual(luego.pendiente.color, "rojo");
  assert.strictEqual(luego.pendiente.motivo, "marcador");
  const fin = reclutar(luego, 7);
  assert.strictEqual(fin.pendiente, null, "una jugada abre un solo reclutamiento");
  assert.notStrictEqual(fin.turno, "rojo");
});

prueba("renunciar tampoco se salta el reclutamiento en cola", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 9, "H4");
  colocar(e, "verde", 4, "G4", { bandera: true });
  e.marcador.rojo = 5;
  e.bajas.rojo.push(7);
  const tras = renunciarARecoger(aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar")));
  assert.strictEqual(tras.pendiente.tipo, "reclutar");
  assert.strictEqual(tras.pendiente.color, "rojo");
});

console.log("\nVISIBILIDAD Y VAIVÉN");

prueba("un jugador solo ve sus propios rangos y sus propias bajas", () => {
  const e = partidaCompleta();
  e.bajas.verde.push(9);
  const vista = vistaDe(e, "rojo");
  assert.ok(vista.piezas.filter((p) => p.color === "rojo").every((p) => p.rango !== null));
  assert.ok(vista.piezas.filter((p) => p.color !== "rojo").every((p) => p.rango === null));
  assert.deepStrictEqual(vista.misBajas, []);
  assert.ok(!("bajas" in vista));
});

prueba("el vaivén se corta tras cinco idas y vueltas", () => {
  let e = estadoVacio();
  const pieza = colocar(e, "rojo", 4, "H4");
  let actual = "H4";
  let otra = "G4";
  for (let i = 0; i < MAX_ALTERNANCIAS; i++) {
    const m = movimientosLegales(e).filter((a) => a.hasta === otra);
    assert.ok(m.length, `movimiento ${i + 1} debería ser legal`);
    e = aplicar(e, m[0]);
    [actual, otra] = [otra, actual];
  }
  const bloqueado = movimientosLegales(e).some((a) => a.pieza === pieza.id && a.hasta === otra);
  assert.strictEqual(bloqueado, false, "la décima alternancia debe estar prohibida");
});

console.log("\nMEMORIA DE RANGOS");

prueba("quien gana un duelo enseña su rango a la mesa", () => {
  let e = estadoVacio();
  const fuerte = colocar(e, "rojo", 7, "D4");
  const debil = colocar(e, "verde", 3, "E4");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar" && a.pieza === fuerte.id));
  assert.strictEqual(tras.rangosRevelados[fuerte.id], 7, "el vencedor queda a la vista");
  assert.ok(!(debil.id in tras.rangosRevelados), "el caído no se guarda: ya no está en el tablero");
});

prueba("el defensor que resiste también queda a la vista", () => {
  let e = estadoVacio();
  const flojo = colocar(e, "rojo", 3, "D4");
  const firme = colocar(e, "verde", 8, "E4");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar" && a.pieza === flojo.id));
  assert.strictEqual(tras.rangosRevelados[firme.id], 8);
  assert.ok(!(flojo.id in tras.rangosRevelados));
});

prueba("del empate no sobrevive nadie, así que no se revela nada", () => {
  let e = estadoVacio();
  const uno = colocar(e, "rojo", 5, "D4");
  const otro = colocar(e, "verde", 5, "E4");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar" && a.pieza === uno.id));
  assert.deepStrictEqual(tras.rangosRevelados, {});
  assert.ok(!(otro.id in tras.rangosRevelados));
});

prueba("el explorador se delata al recorrer más de una casilla", () => {
  let e = estadoVacio();
  const ojeador = colocar(e, "rojo", 3, "H4");
  const lejos = accion(movimientosLegales(e), (a) => a.tipo === "mover" && a.pieza === ojeador.id && a.hasta === "H1");
  const tras = aplicar(e, lejos);
  assert.strictEqual(tras.rangosRevelados[ojeador.id], 3);
});

prueba("el explorador que solo da un paso no se delata", () => {
  let e = estadoVacio();
  const ojeador = colocar(e, "rojo", 3, "H4");
  const corto = accion(movimientosLegales(e), (a) => a.tipo === "mover" && a.pieza === ojeador.id && a.hasta === "H3");
  const tras = aplicar(e, corto);
  assert.deepStrictEqual(tras.rangosRevelados, {});
});

prueba("el capitán se delata al encadenar dos casillas con giro", () => {
  let e = estadoVacio();
  const capitan = colocar(e, "rojo", 6, "H4");
  const conGiro = accion(movimientosLegales(e), (a) => a.tipo === "mover" && a.pieza === capitan.id && a.via);
  const tras = aplicar(e, conGiro);
  assert.strictEqual(tras.rangosRevelados[capitan.id], 6);
});

prueba("un rango revelado se olvida cuando la pieza cae después", () => {
  let e = estadoVacio();
  const medio = colocar(e, "rojo", 5, "D4");
  colocar(e, "verde", 3, "E4");
  let tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar" && a.pieza === medio.id));
  assert.strictEqual(tras.rangosRevelados[medio.id], 5);
  // Ahora cae ante alguien mayor: su rango deja de estar en la memoria.
  const grande = colocar(tras, "verde", 9, "F4");
  tras.turno = "verde";
  const remate = aplicar(tras, accion(movimientosLegales(tras, "verde"), (a) => a.tipo === "atacar" && a.pieza === grande.id));
  assert.ok(!(medio.id in remate.rangosRevelados));
  assert.strictEqual(remate.rangosRevelados[grande.id], 9);
});

console.log("\nHILO DE HISTORIA");

prueba("cada jugada deja una entrada numerada en el hilo", () => {
  let e = estadoVacio();
  const pieza = colocar(e, "rojo", 4, "H4");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "mover" && a.pieza === pieza.id && a.hasta === "H3"));
  assert.strictEqual(tras.historia.length, 1);
  assert.deepStrictEqual(
    { n: tras.historia[0].n, color: tras.historia[0].color, tipo: tras.historia[0].tipo, hasta: tras.historia[0].hasta },
    { n: 1, color: "rojo", tipo: "mover", hasta: "H3" }
  );
});

prueba("el hilo recoge los eventos del duelo", () => {
  let e = estadoVacio();
  const fuerte = colocar(e, "rojo", 7, "D4");
  colocar(e, "verde", 3, "E4");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar" && a.pieza === fuerte.id));
  const entrada = tras.historia[0];
  assert.strictEqual(entrada.tipo, "atacar");
  assert.ok(entrada.eventos.some((ev) => ev.tipo === "duelo" && ev.resultado === "atacante"));
});

prueba("el rango de un reclutamiento no sale del servidor hasta el final", () => {
  // Este rango SÍ se guarda en el hilo, y antes no. La razón es que sin él una
  // partida terminada no se puede reproducir: el replay pierde al recluta y todo
  // lo que haga después, y sin replay no hay forma de analizar qué jugadas
  // decidieron la partida.
  //
  // Lo que no puede pasar es que salga mientras se juega, así que lo tapa
  // `historiaPublica`, y esta prueba vigila las DOS censuras -la del motor y la
  // del servidor- porque son paralelas y es fácil arreglar solo una.
  let e = estadoVacio();
  e.bajas.rojo.push(9);
  e.marcador.rojo = 5;
  const pieza = colocar(e, "rojo", 4, "D4");
  colocar(e, "verde", 3, "E4");
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar" && a.pieza === pieza.id));
  const conRecluta = reclutar(tras, 9);

  const entrada = conRecluta.historia[conRecluta.historia.length - 1];
  assert.strictEqual(entrada.tipo, "reclutar");
  assert.strictEqual(entrada.rango, 9, "el estado interno sí lo guarda: es lo que permite el replay");

  // Censura del motor. Se mira la ENTRADA de reclutamiento y no el hilo entero:
  // los duelos publican los dos rangos y eso sí es público.
  const delHilo = (historia) => historia.find((h) => h.tipo === "reclutar");
  assert.strictEqual(delHilo(vistaDe(conRecluta, "rojo").historia).rango, undefined,
    "vistaDe no puede publicarlo mientras se juega, ni siquiera a quien reclutó");
  assert.strictEqual(delHilo(vistaDe(conRecluta, "verde").historia).rango, undefined, "ni al rival");

  // Censura del servidor.
  const sala = {
    id: "s1", nombre: "p", anfitrion: "u1", privada: false, fase: "jugando", creada: Date.now(),
    despliegues: {}, puestos: { rojo: { tipo: "humano", id: "u1" }, azul: null, verde: null, amarillo: null },
    estado: conRecluta,
  };
  assert.strictEqual(
    delHilo(salaParaJugador(sala, "u1").estado.historia).rango, undefined,
    "el servidor tampoco, y es la censura que de verdad sale por el WebSocket"
  );

  // Y al terminar, destapado: es cuando hace falta para el informe.
  conRecluta.fin = { ganador: "rojo", equipo: ["rojo", "azul"] };
  assert.strictEqual(
    salaParaJugador(sala, "u1").estado.historia.find((h) => h.tipo === "reclutar").rango, 9,
    "terminada la partida el rango tiene que estar, o el replay se queda cojo"
  );
});

prueba("el hilo se recorta por arriba pero la numeración sigue subiendo", () => {
  let e = estadoVacio();
  const pieza = colocar(e, "rojo", 4, "D4");
  // Se pasea en cuadrado por llanura abierta: un ir y venir entre dos casillas
  // lo cortaría la regla del vaivén.
  const ruta = ["E4", "E5", "D5", "D4"];
  for (let i = 0; i < MAX_HISTORIA + 20; i++) {
    const destino = ruta[i % ruta.length];
    const posible = accion(
      movimientosLegales(e),
      (a) => a.tipo === "mover" && a.pieza === pieza.id && a.hasta === destino
    );
    e = aplicar(e, posible);
  }
  assert.strictEqual(e.historia.length, MAX_HISTORIA, "el hilo se queda en su tope");
  const ultima = e.historia[e.historia.length - 1];
  assert.strictEqual(ultima.n, MAX_HISTORIA + 20, "la numeración cuenta todas las jugadas");
  assert.strictEqual(e.historia[0].n, ultima.n - MAX_HISTORIA + 1, "las entradas quedan consecutivas");
});

console.log("\nBOTS");

prueba("el bot no ataca cuando la memoria dice que pierde", () => {
  // Única opción de ataque: contra un mariscal ya revelado. Debe preferir moverse.
  let e = estadoVacio();
  const mio = colocar(e, "rojo", 4, "H4");
  const mariscal = colocar(e, "verde", 9, "H3");
  e.rangosRevelados = { [mariscal.id]: 9 };
  for (let i = 0; i < 40; i++) {
    const elegida = accionDeBot(e, "rojo");
    assert.ok(elegida, "el bot debe encontrar alguna jugada");
    assert.ok(
      !(elegida.tipo === "atacar" && elegida.hasta === "H3"),
      "sabe que el mariscal le gana: no debería atacarle"
    );
  }
  assert.strictEqual(mio.rango, 4);
});

prueba("el bot ataca cuando la memoria dice que gana", () => {
  let e = estadoVacio();
  colocar(e, "rojo", 8, "H4");
  const flojo = colocar(e, "verde", 2, "H3");
  e.rangosRevelados = { [flojo.id]: 2 };
  let ataques = 0;
  for (let i = 0; i < 40; i++) {
    const elegida = accionDeBot(e, "rojo");
    if (elegida.tipo === "atacar" && elegida.hasta === "H3") ataques++;
  }
  assert.strictEqual(ataques, 40, "una captura segura debería elegirse siempre");
});

prueba("el espía va a por el mariscal que ya tiene fichado", () => {
  let e = estadoVacio();
  colocar(e, "rojo", 2, "H4");
  const mariscal = colocar(e, "verde", 9, "H3");
  e.rangosRevelados = { [mariscal.id]: 9 };
  let ataques = 0;
  for (let i = 0; i < 40; i++) {
    const elegida = accionDeBot(e, "rojo");
    if (elegida.tipo === "atacar" && elegida.hasta === "H3") ataques++;
  }
  assert.strictEqual(ataques, 40, "es justo el golpe para el que sirve el espía");
});

prueba("el bot clásico, sin memoria, sí se estrella contra el mariscal", () => {
  // Sirve de contraste: es la diferencia que introduce la memoria.
  let e = estadoVacio();
  colocar(e, "rojo", 4, "H4");
  const mariscal = colocar(e, "verde", 9, "H3");
  e.rangosRevelados = { [mariscal.id]: 9 };
  let ataques = 0;
  for (let i = 0; i < 40; i++) {
    const elegida = accionDeBotClasico(e, "rojo");
    if (elegida.tipo === "atacar" && elegida.hasta === "H3") ataques++;
  }
  assert.ok(ataques > 0, "el clásico ignora la memoria y ataca igual");
});

prueba("los bots solo miran la memoria pública, nunca el rango oculto", () => {
  // Dos estados idénticos salvo el rango escondido del defensor. Si el bot
  // espiara el estado, cambiaría de idea; con solo memoria pública, no.
  function escenario(rangoOculto) {
    const e = estadoVacio();
    colocar(e, "rojo", 5, "H4");
    colocar(e, "verde", rangoOculto, "H3");
    return e;
  }
  // El azar va sembrado y es el MISMO para los dos escenarios. Antes la prueba
  // se apoyaba en que el bot fuera determinista de hecho; en cuanto la decisión
  // quedó ajustada, el desempate aleatorio la volcaba y la prueba fallaba sin
  // que hubiera ninguna fuga. Sembrando el azar, cualquier diferencia que
  // aparezca es información y no ruido.
  function sembrado(semilla) {
    let a = semilla >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  const conDebil = escenario(1);
  const conFuerte = escenario(9);
  for (let i = 0; i < 300; i++) {
    const conDebilJuega = accionDeBot(conDebil, "rojo", { azar: sembrado(i + 1) });
    const conFuerteJuega = accionDeBot(conFuerte, "rojo", { azar: sembrado(i + 1) });
    assert.deepStrictEqual(
      { tipo: conDebilJuega.tipo, hasta: conDebilJuega.hasta },
      { tipo: conFuerteJuega.tipo, hasta: conFuerteJuega.hasta },
      `con el mismo azar, la jugada ${i} debería ser idéntica: el rango escondido no se ve`
    );
  }
});

prueba("resolverDuelo trabaja con rangos sueltos", () => {
  assert.strictEqual(resolverDuelo(2, 9), "atacante");
  assert.strictEqual(resolverDuelo(9, 2), "atacante");
  assert.strictEqual(resolverDuelo(5, 5), "empate");
  assert.strictEqual(resolverDuelo(3, 7), "defensor");
});


prueba("los bots CON RED tampoco ven el rango oculto", () => {
  // El servidor ya no mueve con `accionDeBot` sino con `accionConRed`, que pasa
  // por otro camino entero: los rasgos de jugada y de posición. La prueba de
  // arriba no lo cubría, y una fuga ahí sería peor -no cambiaría el resultado de
  // ninguna prueba, solo haría que el bot jugase demasiado bien-.
  //
  // Se comprueba sobre los RASGOS, no sobre la jugada elegida: si los dos
  // escenarios producen el mismo vector de entrada, ninguna red posible puede
  // distinguirlos. Es una garantía más fuerte que comparar decisiones, que
  // depende de los pesos que tenga la red ese día.
  function escenario(rangoOculto) {
    const e = estadoVacio();
    colocar(e, "rojo", 5, "H4");
    colocar(e, "verde", rangoOculto, "H3");
    colocar(e, "rojo", 7, "G4");
    colocar(e, "azul", 6, "D8");
    return e;
  }
  const debil = escenario(1);
  const fuerte = escenario(9);

  const ctxD = contextoDeTurno(debil, "rojo", analizarTurno(debil, "rojo", DISTANCIA));
  const ctxF = contextoDeTurno(fuerte, "rojo", analizarTurno(fuerte, "rojo", DISTANCIA));

  const jugadas = movimientosLegales(debil, "rojo");
  assert.ok(jugadas.length > 0, "el escenario debería dar jugadas legales");

  for (const accion of jugadas) {
    const a = Array.from(rasgosDeJugada(debil, "rojo", accion, ctxD));
    const b = Array.from(rasgosDeJugada(fuerte, "rojo", accion, ctxF));
    const distinto = a.findIndex((v, i) => v !== b[i]);
    assert.strictEqual(
      distinto, -1,
      `el rasgo "${distinto >= 0 ? NOMBRES_RASGOS[distinto] : ""}" cambia con el rango escondido ` +
        `(${distinto >= 0 ? a[distinto] : ""} vs ${distinto >= 0 ? b[distinto] : ""}): eso es una fuga`
    );
  }
});

prueba("una vez revelado, el rango SÍ se usa", () => {
  // El complemento de la prueba anterior: si los rasgos nunca cambiaran, la
  // memoria no serviría de nada y la fuga estaría tapada por accidente.
  function escenario(rangoOculto, revelar) {
    const e = estadoVacio();
    colocar(e, "rojo", 5, "H4");
    const pieza = colocar(e, "verde", rangoOculto, "H3");
    if (revelar) e.rangosRevelados = { [pieza.id]: rangoOculto };
    return e;
  }
  const tapado = escenario(9, false);
  const visto = escenario(9, true);
  const ctxT = contextoDeTurno(tapado, "rojo", analizarTurno(tapado, "rojo", DISTANCIA));
  const ctxV = contextoDeTurno(visto, "rojo", analizarTurno(visto, "rojo", DISTANCIA));
  const ataque = movimientosLegales(tapado, "rojo").find((a) => a.tipo === "atacar");
  assert.ok(ataque, "debería haber un ataque posible contra H3");
  const a = Array.from(rasgosDeJugada(tapado, "rojo", ataque, ctxT));
  const b = Array.from(rasgosDeJugada(visto, "rojo", ataque, ctxV));
  assert.notDeepStrictEqual(a, b, "con el rango ya revelado los rasgos tienen que cambiar");
});

prueba("cargarModelos rechaza un modelo con otro número de entradas", () => {
  // El fallo que esta comprobación evita no da ningún error: un modelo viejo se
  // carga, evalúa y juega con basura. Ya pasó al añadir rasgos.
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "reuter4-modelos-"));
  fs.writeFileSync(
    path.join(carpeta, "red-jugada.json"),
    JSON.stringify({ activacion: ACTIVACION, red: { capas: [7, 3, 1], pesos: [], sesgos: [] } })
  );
  const cargado = cargarModelos(carpeta);
  assert.strictEqual(cargado.jugada, null, "un modelo de 7 entradas no puede cargarse");
  assert.ok(
    cargado.notas.some((n) => n.includes("obsoleto")),
    "y tiene que decir por qué, no fallar en silencio"
  );
  assert.strictEqual(cargado.despliegue, null, "sin fichero, null y a la heurística");
  fs.rmSync(carpeta, { recursive: true, force: true });
});


prueba("cubiertoPorLago mide la línea de aproximación, no la adyacencia", () => {
  // Este rasgo estuvo nueve veces muerto: preguntaba si la casilla era adyacente
  // a un lago, y ninguna de las 84 casillas de despliegue lo es. Los lagos están
  // a 2, 3 o 4 pasos, siempre. Lo que tiene que medir es si el lago CORTA la
  // línea por la que vendría el enemigo.
  let conCobertura = 0;
  let sinCobertura = 0;
  for (const color of COLORES) {
    for (const casilla of casillasDeZona(color)) {
      const v = propiedadesDePieza(color, casilla, 1).cubiertoPorLago;
      assert.ok(v >= 0 && v <= 1, `${casilla}: ${v} fuera de [0,1]`);
      if (v > 0) conCobertura++;
      else sinCobertura++;
    }
  }
  assert.ok(conCobertura > 0, "si nada tiene cobertura, el rasgo vuelve a estar muerto");
  assert.ok(sinCobertura > 0, "si todo tiene cobertura, tampoco distingue nada");

  // Y la geometría concreta: la columna H de la zona roja tiene enfrente el
  // bloque de lago G5-I5, así que cubre más cuanto más cerca está de él.
  const h3 = propiedadesDePieza("rojo", "H3", 1).cubiertoPorLago;
  const h1 = propiedadesDePieza("rojo", "H1", 1).cubiertoPorLago;
  assert.ok(h3 > h1, `H3 (${h3}) está más cerca del lago que H1 (${h1}) y debería cubrir más`);
});

prueba("un modelo con otra firma de rasgos se rechaza aunque el tamaño cuadre", () => {
  // El tamaño no basta: `juntoALago` pasó a ser `cubiertoPorLago` sin cambiar
  // cuántas entradas hay. Un modelo viejo habría pasado la comprobación de
  // tamaño y habría seguido jugando, con un peso entrenado sobre un cero
  // constante recibiendo de pronto valores que varían.
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "reuter4-firma-"));
  const capas = [83, 4, 1];
  fs.writeFileSync(
    path.join(carpeta, "red-despliegue.json"),
    JSON.stringify({ activacion: ACTIVACION, firmaRasgos: "0badf00d", red: { capas, pesos: [], sesgos: [] } })
  );
  const malo = cargarModelos(carpeta);
  assert.strictEqual(malo.despliegue, null, "otra firma: no se carga");
  assert.ok(malo.notas.some((n) => n.includes("otros rasgos")), "y dice por qué");

  // Con la firma correcta sí pasa la comprobación de firma; que la red esté
  // vacía es otro problema, así que se comprueba solo que no la rechace POR la
  // firma.
  fs.writeFileSync(
    path.join(carpeta, "red-despliegue.json"),
    JSON.stringify({ firmaRasgos: FIRMA_DESPLIEGUE, red: { capas, pesos: [], sesgos: [] } })
  );
  const bueno = cargarModelos(carpeta);
  assert.ok(!bueno.notas.some((n) => n.includes("otros rasgos")), "con la firma buena no debería quejarse de la firma");
  fs.rmSync(carpeta, { recursive: true, force: true });
});






prueba("la geometría de tiro al anillo existe y tiene gradiente", () => {
  // Sin el conjunto no hay a dónde ir; sin el gradiente el cañón nunca se pone
  // en marcha, porque a seis pasos ningún movimiento suelto le hace cobrar nada.
  assert.ok(BATEN_ANILLO.size > 0, "ninguna casilla bate el anillo: el cañón no sirve para nada");
  assert.ok(BATEN_ANILLO.size < CASILLAS.length / 3, "si baten casi todas, el rasgo no distingue");
  for (const c of BATEN_ANILLO) assert.strictEqual(PASOS_A_TIRO[c], 0, `${c} bate el anillo y no está a distancia 0`);
  const fuera = CASILLAS.filter((c) => PASOS_A_TIRO[c] === undefined);
  assert.deepStrictEqual(fuera, [], "hay casillas sin distancia a una posición de tiro");
});

prueba("el análisis ve al rival que va a coronar en su turno", () => {
  // Se gana llegando a la TORRE con bandera aliada, así que el rival urgente es
  // el que ya está en el ANILLO llevándola: le queda un movimiento.
  const conBandera = estadoVacio();
  const suyo = colocar(conBandera, "verde", 6, ANILLO_T);
  suyo.bandera = "verde";
  conBandera.banderas.verde = { portador: suyo.id, casilla: null, ultimoDueño: "verde" };
  const a1 = analizarTurno(conBandera, "rojo", DISTANCIA);
  assert.ok(a1.coronadorRival, "un rival en el anillo con su bandera es un coronador");
  assert.strictEqual(a1.coronadorRival.id, suyo.id);

  // El mismo rival sin bandera no está a punto de nada.
  const sinBandera = estadoVacio();
  colocar(sinBandera, "verde", 6, ANILLO_T);
  assert.strictEqual(analizarTurno(sinBandera, "rojo", DISTANCIA).coronadorRival, null);

  // Y el del propio equipo tampoco es un "rival".
  const socio = estadoVacio();
  const mio = colocar(socio, "azul", 6, ANILLO_T);
  mio.bandera = "azul";
  socio.banderas.azul = { portador: mio.id, casilla: null, ultimoDueño: "azul" };
  assert.strictEqual(analizarTurno(socio, "rojo", DISTANCIA).coronadorRival, null, "el compañero no es un coronador rival");
});

prueba("el cañón prefiere batir al que va a coronar antes que a una pieza mayor", () => {
  // Es la comprobación que justifica el peso: sin `disparoAlCoronador`, el
  // disparo valía solo por el rango, así que un mariscal en mitad del campo
  // ganaba a un capitán a un movimiento de la victoria.
  const e = estadoVacio();
  colocar(e, "rojo", 1, "H6");           // mi cañón: al sur tiene el anillo pegado
  const coronador = colocar(e, "verde", 6, ANILLO_T);
  coronador.bandera = "verde";
  e.banderas.verde = { portador: coronador.id, casilla: null, ultimoDueño: "verde" };
  // H7 es huella del castillo, no una casilla: el mariscal va al norte, y la
  // bala le llega sobrevolando el lago de H5.
  const gordo = colocar(e, "verde", 9, "H4");
  e.rangosRevelados = { [gordo.id]: 9, [coronador.id]: 6 };

  const legales = movimientosLegales(e, "rojo").filter((a) => a.tipo === "disparar");
  const objetivos = legales.map((a) => a.hasta);
  assert.ok(objetivos.includes(ANILLO_T), `debería poder batir el anillo; puede: ${objetivos.join(" ")}`);
  assert.ok(objetivos.includes("H4"), `y también al mariscal; puede: ${objetivos.join(" ")}`);

  const elegida = accionDeBot(e, "rojo");
  assert.strictEqual(elegida.tipo, "disparar");
  assert.strictEqual(elegida.hasta, ANILLO_T, "parar la coronación vale más que llevarse un mariscal");
});

prueba("tapa el tiro también cuando el que va a coronar es uno mismo", () => {
  // Una bandera solo la corona una pieza de su propio color, así que el equipo
  // puede ganar por dos vías -yo con la mía o el compañero con la suya- y las
  // dos piden lo mismo: que nadie pueda batir el anillo cuando toque subir.
  // Mirar solo al compañero dejaba fuera la mitad de los casos, y justo los que
  // uno juega en primera persona.
  const escenario = (quienCorona, rangoDelTapador) => {
    const e = estadoVacio();
    const portador = colocar(e, quienCorona, 5, "H6");
    portador.bandera = quienCorona;
    e.banderas[quienCorona] = { portador: portador.id, casilla: null, ultimoDueño: quienCorona };
    const canon = colocar(e, "verde", 1, "H12");   // bate el anillo pasando por H10
    colocar(e, "rojo", rangoDelTapador, "G10");
    e.rangosRevelados = { [canon.id]: 1 };
    return e;
  };

  for (const [quien, rango] of [["azul", 4], ["rojo", 4], ["rojo", 3]]) {
    const e = escenario(quien, rango);
    const analisis = analizarTurno(e, "rojo", DISTANCIA);
    assert.ok(analisis.equipoAPuntoDeCoronar, `con ${quien} a un paso, el equipo está a punto de coronar`);
    assert.ok(analisis.tapanElAnillo.has("H10"), "H10 corta la línea H12->anillo");
    const elegida = accionDeBot(e, "rojo");
    assert.strictEqual(
      elegida && elegida.hasta, "H10",
      `con ${quien} a punto de coronar y un rango ${rango} en G10, debería taparse el tiro`
    );
  }

  // Y un cañón NO se usa de tapón: no combate cuerpo a cuerpo, plantarlo ahí es
  // regalarlo.
  const conCanon = estadoVacio();
  const portador = colocar(conCanon, "rojo", 5, "H6");
  portador.bandera = "rojo";
  conCanon.banderas.rojo = { portador: portador.id, casilla: null, ultimoDueño: "rojo" };
  const enemigo = colocar(conCanon, "verde", 1, "H12");
  const miCanon = colocar(conCanon, "rojo", 1, "G10");
  conCanon.rangosRevelados = { [enemigo.id]: 1 };
  const conCanonElegida = accionDeBot(conCanon, "rojo");
  const fueElCanon = conCanonElegida && conCanonElegida.pieza === miCanon.id && conCanonElegida.hasta === "H10";
  assert.ok(!fueElCanon, "un cañón no debería plantarse de tapón");
});

prueba("el bot tapa la línea de tiro cuando el compañero va a coronar", () => {
  // La tarea que no existía: solo había "no me meta YO en una línea de tiro".
  const e = estadoVacio();
  // El compañero, con su bandera, a un paso del castillo.
  const socio = colocar(e, "azul", 5, "H6");
  socio.bandera = "azul";
  e.banderas.azul = { portador: socio.id, casilla: null, ultimoDueño: "azul" };
  // Un cañón enemigo identificado apuntando al castillo desde el sur: desde H12
  // la bala sobrevuela el lago de H11, pasa por H10 y llega al anillo. H10 es
  // justo la casilla que hay que ocupar para cortarle el tiro.
  const canon = colocar(e, "verde", 1, "H12");

  const analisis = analizarTurno(e, "rojo", DISTANCIA);
  assert.ok(analisis.socio.aPuntoDeCoronar, "el compañero debería contar como a punto de coronar");
  e.rangosRevelados = { [canon.id]: 1 };
  const conMemoria = analizarTurno(e, "rojo", DISTANCIA);
  assert.ok(
    conMemoria.tapanElAnillo.has("H10"),
    `H10 corta la línea H12->anillo y debería estar en la lista; están: ${[...conMemoria.tapanElAnillo].join(" ")}`
  );
  // Y una pieza que puede llegar a H10 debería querer ir.
  colocar(e, "rojo", 4, "G10");
  const conPieza = analizarTurno(e, "rojo", DISTANCIA);
  assert.ok(conPieza.tapanElAnillo.has("H10"), "la casilla que tapa sigue estando");
});


prueba("los rasgos del castillo caen en la casilla que dice su nombre", () => {
  // Esta prueba existe por un fallo concreto: al insertar rasgos en mitad de la
  // lista, los nombres se desincronizaron de las llamadas a `pon` y TODOS los
  // rasgos posteriores quedaron mal etiquetados, sin error ninguno. Se detectó
  // de milagro, viendo que dos rangos daban el mismo valor donde no debían.
  assert.strictEqual(NOMBRES_RASGOS.length, TAMANO_JUGADA, "hay más nombres que entradas o al revés");
  const indice = (nombre) => {
    const i = NOMBRES_RASGOS.indexOf(`jugada · ${nombre}`);
    assert.ok(i >= 0, `no existe el rasgo ${nombre}`);
    return i;
  };

  // Escenario: mi cañón en H6 puede batir el anillo, donde hay un coronador.
  const e = estadoVacio();
  colocar(e, "rojo", 1, "H6");
  const coronador = colocar(e, "verde", 6, ANILLO_T);
  coronador.bandera = "verde";
  e.banderas.verde = { portador: coronador.id, casilla: null, ultimoDueño: "verde" };
  e.rangosRevelados = { [coronador.id]: 6 };

  const ctx = contextoDeTurno(e, "rojo", analizarTurno(e, "rojo", DISTANCIA));
  const tiro = movimientosLegales(e, "rojo").find((a) => a.tipo === "disparar" && a.hasta === ANILLO_T);
  assert.ok(tiro, "debería poder batir el anillo");
  const v = rasgosDeJugada(e, "rojo", tiro, ctx);
  assert.strictEqual(v[indice("disparoAlCoronador")], 1, "el disparo para una coronación y el rasgo no lo dice");
  assert.strictEqual(v[indice("canonHaciaElTiro")], 0, "esto es un disparo, no un desplazamiento de cañón");
  assert.strictEqual(v[indice("tapaLineaAlAnillo")], 0, "no se está tapando nada");

  // Y un movimiento del cañón hacia una posición de tiro sí marca el suyo.
  const m = estadoVacio();
  const canon = colocar(m, "rojo", 1, "H2");
  const ctxM = contextoDeTurno(m, "rojo", analizarTurno(m, "rojo", DISTANCIA));
  const acerca = movimientosLegales(m, "rojo").find(
    (a) => a.tipo === "mover" && a.pieza === canon.id && PASOS_A_TIRO[a.hasta] < PASOS_A_TIRO[a.desde]
  );
  assert.ok(acerca, `el cañón de H2 (a ${PASOS_A_TIRO["H2"]} pasos del tiro) debería poder acercarse`);
  const w = rasgosDeJugada(m, "rojo", acerca, ctxM);
  assert.ok(w[indice("canonHaciaElTiro")] > 0, "acercarse a una posición de tiro debería marcar");
  assert.strictEqual(w[indice("disparoAlCoronador")], 0, "no hay ningún coronador que parar");
});


prueba("un cañón bate la torre desde cualquiera de las doce casillas del castillo", () => {
  // Es ADYACENCIA al castillo, no línea de tiro. Se ve con G6: pegada al
  // castillo por arriba, pero en línea recta al sur solo encuentra G7, G8 y G9,
  // que son celdas del anillo, nunca la torre. La bala pasa por encima.
  // `rayo` no devuelve TORRE nunca, así que este tiro lo genera el motor aparte.
  const DOCE = ["G6", "H6", "I6", "F7", "F8", "F9", "J7", "J8", "J9", "G10", "H10", "I10"];
  const tiros = (desde, anilloOcupado = false) => {
    const e = estadoVacio();
    colocar(e, "rojo", 1, desde);
    colocar(e, "verde", 5, TORRE);
    if (anilloOcupado) colocar(e, "verde", 4, ANILLO_T);
    return movimientosLegales(e, "rojo").filter((a) => a.tipo === "disparar").map((a) => a.hasta);
  };

  for (const desde of DOCE) {
    assert.ok(tiros(desde).includes(TORRE), `desde ${desde} debería batirse la torre`);
  }
  assert.deepStrictEqual([...BATEN_LA_TORRE].sort(), DOCE.slice().sort(), "la lista derivada cambió");

  // El anillo ocupado no tapa: la bala pasa por encima, y batir al del anillo
  // queda como una opción distinta que el bot puede preferir.
  const conAlguienEnElAnillo = tiros("G6", true);
  assert.ok(conAlguienEnElAnillo.includes(TORRE), "el anillo ocupado no tapa el tiro a la torre");
  assert.ok(conAlguienEnElAnillo.includes(ANILLO_T), "y batir al del anillo sigue siendo posible");

  // Un cañón metido en el anillo no tiene forma de atacar la torre: no bate
  // desde ahí y no puede combatir cuerpo a cuerpo.
  const e = estadoVacio();
  colocar(e, "rojo", 1, ANILLO_T);
  colocar(e, "verde", 5, TORRE);
  const desdeElAnillo = movimientosLegales(e, "rojo").filter((a) => a.hasta === TORRE);
  assert.deepStrictEqual(desdeElAnillo, [], "un cañón en el anillo no ataca la torre");
});

prueba("cualquier pieza ataca la torre desde el anillo, cuerpo a cuerpo", () => {
  // Sobre el tablero de verdad el anillo son ocho celdas (G7 H7 I7 G8 I8 G9 H9
  // I9) y la torre es H8; aquí el anillo es una sola pseudocasilla.
  const e = estadoVacio();
  colocar(e, "rojo", 5, ANILLO_T);
  colocar(e, "verde", 4, TORRE);
  const ataques = movimientosLegales(e, "rojo").filter((a) => a.tipo === "atacar" && a.hasta === TORRE);
  assert.strictEqual(ataques.length, 1, "desde el anillo se ataca la torre");
});

prueba("no se dispara a un aliado en la torre", () => {
  const e = estadoVacio();
  colocar(e, "rojo", 1, "H6");
  colocar(e, "azul", 5, TORRE);   // el compañero
  const tiros = movimientosLegales(e, "rojo").filter((a) => a.tipo === "disparar");
  assert.deepStrictEqual(tiros, [], "al compañero no se le dispara");
});


prueba("el servidor no manda un solo rango ajeno mientras la partida sigue", () => {
  // La censura del servidor no se podía probar porque servidor.mjs abre el
  // puerto al importarse; ahora vive en servidor/vista.mjs. Es LA función que no
  // puede fallar: si se filtra un rango, el juego deja de tener sentido y no
  // falla nada.
  const estado = partidaCompleta();
  const sala = {
    id: "s1", nombre: "prueba", anfitrion: "u-rojo", privada: false, fase: "jugando",
    creada: Date.now(), despliegues: { rojo: [{ casilla: "H2", rango: 9 }] },
    puestos: { rojo: { tipo: "humano", id: "u-rojo" }, azul: null, verde: null, amarillo: null },
    estado,
  };

  const vista = salaParaJugador(sala, "u-rojo");
  const ajenas = Object.values(vista.estado.piezas).filter((p) => p.color !== "rojo");
  assert.ok(ajenas.length > 0, "el escenario debería tener piezas ajenas");
  assert.ok(ajenas.every((p) => p.rango === null), "se ha filtrado un rango ajeno");
  assert.strictEqual(vista.despliegues, undefined, "los despliegues iniciales llevan los rangos de todos");

  // Y a un espectador sin puesto tampoco.
  const mirón = salaParaJugador(sala, "u-nadie");
  assert.ok(Object.values(mirón.estado.piezas).every((p) => p.rango === null), "el espectador no ve ningún rango");
});

prueba("al terminar la partida el servidor destapa los cuatro ejércitos", () => {
  // Es la única situación en la que salen los rangos ajenos, y la condición mira
  // `estado.fin` -que la partida no pueda continuar- y no la fase de la sala,
  // que puede quedarse en "fin" por otros caminos.
  const estado = partidaCompleta();
  const sala = {
    id: "s1", nombre: "prueba", anfitrion: "u-rojo", privada: false, fase: "fin",
    creada: Date.now(), despliegues: { rojo: [{ casilla: "H2", rango: 9 }] },
    puestos: { rojo: { tipo: "humano", id: "u-rojo" }, azul: null, verde: null, amarillo: null },
    estado,
  };

  // Con la fase ya en "fin" pero sin `estado.fin`, NO se destapa.
  assert.ok(
    Object.values(salaParaJugador(sala, "u-rojo").estado.piezas).some((p) => p.color !== "rojo" && p.rango === null),
    "la fase por sí sola no debería destapar nada"
  );

  estado.fin = { ganador: "rojo", equipo: ["rojo", "azul"] };
  const vista = salaParaJugador(sala, "u-rojo");
  assert.ok(
    Object.values(vista.estado.piezas).every((p) => p.rango !== null),
    "terminada la partida deberían verse todos los rangos"
  );
  assert.ok(vista.despliegues, "y los despliegues iniciales, que el informe necesita");
});


prueba("en el informe las piezas caen sobre su casilla del tablero de fondo", () => {
  // `coord` devuelve la columna en base 0 y la fila en base 1: coord("A1") es
  // [0, 1]. Tratar las dos igual desplazaba las columnas -y solo las columnas-
  // una casilla a la izquierda. El fondo salía bien porque construye los nombres
  // desde un contador base 1, así que el desajuste solo se veía mirando el
  // dibujo: las flechas y las fichas encima, corridas.
  //
  // Aquí se recalcula la posición del fondo de forma independiente, a partir del
  // nombre de la casilla, y se exige que el centro caiga dentro de ese cuadro.
  const casillaDelFondo = (nombre) => {
    const columna = nombre.charCodeAt(0) - 64;      // A = 1
    const fila = parseInt(nombre.slice(1), 10);
    return { x: MARGEN + (columna - 1) * CELDA, y: MARGEN + (fila - 1) * CELDA };
  };

  for (const nombre of CASILLAS) {
    if (nombre === ANILLO_T || nombre === TORRE) continue; // pseudocasillas
    const c = centroEnInforme(nombre);
    assert.ok(c, `${nombre} no tiene centro`);
    const caja = casillaDelFondo(nombre);
    assert.ok(
      c.x > caja.x && c.x < caja.x + CELDA && c.y > caja.y && c.y < caja.y + CELDA,
      `${nombre}: el centro (${c.x}, ${c.y}) cae fuera de su cuadro (${caja.x}, ${caja.y})–(${caja.x + CELDA}, ${caja.y + CELDA})`
    );
  }

  // Y las esquinas, dentro del lienzo.
  const fin = MARGEN + LADO * CELDA;
  for (const nombre of ["A1", "O15"]) {
    const c = centroEnInforme(nombre);
    assert.ok(c.x > MARGEN && c.x < fin && c.y > MARGEN && c.y < fin, `${nombre} se sale del lienzo`);
  }
});


prueba("el informe reconstruye de qué rango era cada jugada", () => {
  // El hilo guarda color, tipo, origen y destino, pero no el rango de quien
  // mueve: mientras se juega eso es información oculta. Terminada la partida se
  // reconstruye partiendo del despliegue inicial y aplicando el hilo entero.
  //
  // Y la reconstrucción trae su propia vara: los duelos SÍ publican los dos
  // rangos, así que si el replay no coincide con lo que dice el duelo, el replay
  // está mal.
  //
  // Se juegan VARIAS partidas y se acumulan las comprobaciones: con una sola
  // salían dos duelos, y elegir la semilla que diera más habría sido escoger el
  // caso que conviene.
  const generador = (semilla) => {
    let a = semilla >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  };

  let duelosComprobados = 0;
  let jugadasTotales = 0;
  let identificadasTotales = 0;

  for (const semilla of [4242, 90210, 31415, 27182]) {
    const azar = generador(semilla);
    const despliegues = {};
    for (const color of COLORES) despliegues[color] = despliegueAleatorio(color, azar);

    let e = nuevaPartida(despliegues, { primero: "rojo" });
    let turnos = 0;
    while (!e.fin && turnos < 300) {
      if (e.pendiente) {
        const p = e.pendiente;
        e = p.tipo === "recoger"
          ? (decisionDeRecogida(e, p.color) ? recogerLaBandera(e) : renunciarARecoger(e))
          : reclutar(e, Math.max(...p.opciones));
        continue;
      }
      const a = accionDeBot(e, e.turno, { azar });
      if (!a) break;
      e = aplicar(e, a);
      turnos++;
    }

    const historia = e.historia || [];
    const rangos = reconstruirRangos(despliegues, historia);
    assert.strictEqual(rangos.length, historia.length);

    historia.forEach((h, i) => {
      const duelo = (h.eventos || []).find((ev) => ev.tipo === "duelo");
      if (!duelo) return;
      duelosComprobados++;
      assert.strictEqual(
        rangos[i], duelo.atacante.rango,
        `semilla ${semilla}, jugada ${h.n}: el replay dice ${rangos[i]} y el duelo dice ${duelo.atacante.rango}`
      );
    });

    // La afirmación exacta, en vez de un porcentaje a ojo: si en la partida NO
    // ha reclutado nadie, todas las jugadas tienen que quedar identificadas. Un
    // recluta es lo único irrecuperable -su rango no se publica- y sigue jugando
    // el resto de la partida, así que en cuanto aparece uno, el porcentaje deja
    // de significar nada.
    // Solo cuentan las entradas que SON un movimiento: recoger una bandera o
    // renunciar a ella son decisiones y no tienen origen, así que no hay rango
    // que identificar. Esta prueba lo confundía y señalaba seis "fallos" que no
    // lo eran; de paso destapó que el informe las renderizaba como
    // "undefined va a undefined".
    const huboReclutas = historia.some((h) => h.tipo === "reclutar");
    const sinIdentificar = historia.filter((h, i) => h.desde && !rangos[i]).length;
    if (!huboReclutas) {
      assert.strictEqual(
        sinIdentificar, 0,
        `semilla ${semilla}: sin reclutamientos deberían identificarse todas, y faltan ${sinIdentificar}`
      );
    }

    jugadasTotales += historia.filter((h) => h.desde).length;
    identificadasTotales += historia.filter((h, i) => h.desde && rangos[i]).length;
  }

  assert.ok(duelosComprobados >= 8, `hacen falta duelos para comprobar nada; hubo ${duelosComprobados}`);
  assert.strictEqual(
    identificadasTotales, jugadasTotales,
    `${jugadasTotales - identificadasTotales} jugadas sin identificar: el replay pierde piezas`
  );
});


prueba("la sospecha de cañón baja según van cayendo", () => {
  // Un cañón no se revela JAMÁS: no sobrevive a un duelo y no se delata al
  // moverse. Medido, 0 revelados en 7.335 turnos. Así que mirar solo
  // `rangosRevelados` daba "quedan 2 de 2" toda la partida, incluso después de
  // que el rival hubiera gastado los dos, y el portador de la bandera se quedaba
  // esperando a un cañón que ya no existía.
  //
  // Las caídas SÍ son públicas: toda muerte publica el rango. Lo que no lo es,
  // es qué rango recupera un reclutamiento, así que un recluta solo devuelve la
  // POSIBILIDAD de cañón, y como mucho tantas veces como cañones hayan caído.
  const escenario = (canonesCaidos, reclutas) => {
    const e = estadoVacio();
    colocar(e, "rojo", 5, "H6");
    // H4 bate hacia el sur: la bala sobrevuela el lago de H5 y pasa por H6.
    // (H5 y H11 son lagos, así que no vale poner piezas en cualquier sitio.)
    for (const casilla of ["H4", "G4", "I4", "G2"]) colocar(e, "verde", 4, casilla);
    e.caidosPublicos = { rojo: [], verde: Array(canonesCaidos).fill(1), azul: [], amarillo: [] };
    e.reclutas = { rojo: 0, verde: reclutas, azul: 0, amarillo: 0 };
    return e;
  };
  const sospecha = (e) => {
    const a = analizarTurno(e, "rojo", DISTANCIA);
    return peligroEn(a, "H6", 5).riesgoCanon;
  };

  const sinCaer = sospecha(escenario(0, 0));
  const unoCaido = sospecha(escenario(1, 0));
  const dosCaidos = sospecha(escenario(2, 0));
  const dosYRecluta = sospecha(escenario(2, 1));

  assert.ok(sinCaer > 0, "con los dos cañones vivos debería haber sospecha");
  assert.ok(unoCaido < sinCaer, `con uno caído la sospecha debería bajar: ${sinCaer} -> ${unoCaido}`);
  assert.strictEqual(dosCaidos, 0, "gastados los dos y sin reclutar, no queda ninguno: el anillo es seguro");
  assert.ok(
    dosYRecluta > 0 && dosYRecluta <= unoCaido,
    `un recluta devuelve la posibilidad de UN cañón, no más: salió ${dosYRecluta}`
  );

  // Y un recluta sin cañones caídos no inventa cañones.
  assert.strictEqual(sospecha(escenario(0, 3)), sinCaer, "reclutar sin cañones caídos no cambia la sospecha");
});

prueba("las caídas públicas no delatan qué recupera un reclutamiento", () => {
  // `bajas` es la bolsa de reclutamiento y `reclutar` SACA de ella el rango
  // recuperado; leerla para otro color sería saber QUÉ pieza ha vuelto, y eso no
  // es público. `caidosPublicos` solo apunta y nunca quita.
  const e = estadoVacio();
  e.marcador.rojo = 5;
  colocar(e, "rojo", 6, "H4");
  colocar(e, "verde", 3, "H3");   // H5 es lago; el vecino jugable es H3
  const tras = aplicar(e, accion(movimientosLegales(e), (a) => a.tipo === "atacar" && a.hasta === "H3"));
  assert.deepStrictEqual(tras.caidosPublicos.verde, [3], "la caída se apunta con su rango");
  assert.deepStrictEqual(tras.bajas.verde, [3], "y también entra en la bolsa de reclutamiento");
});


prueba("con varias líneas batiendo el anillo, tapar una no cuenta como cubrirlo", () => {
  // Es la corrección de fondo: tapar UNA línea de tres no permite coronar,
  // porque el rival dispara por cualquiera de las otras dos. Lo que abre la
  // subida es dejarlas todas tapadas.
  const e = estadoVacio();
  const portador = colocar(e, "rojo", 5, "H6");
  portador.bandera = "rojo";
  e.banderas.rojo = { portador: portador.id, casilla: null, ultimoDueño: "rojo" };
  // Tres cañones enemigos identificables por la bolsa: apuntan desde tres lados.
  const a = colocar(e, "verde", 1, "H12");   // bate pasando por H10
  const b = colocar(e, "verde", 1, "D8");    // por el oeste
  const c = colocar(e, "verde", 1, "L8");    // por el este
  e.rangosRevelados = { [a.id]: 1, [b.id]: 1, [c.id]: 1 };

  const analisis = analizarTurno(e, "rojo", DISTANCIA);
  assert.ok(analisis.lineasAlAnillo.length >= 3, `deberían verse al menos tres líneas; hay ${analisis.lineasAlAnillo.length}`);

  // Tapar la del norte deja las otras abiertas.
  const tapandoUna = lineasAbiertasSi(analisis, "H10");
  assert.ok(tapandoUna > 0, "tapando una sola no debería quedar el anillo cubierto");
  assert.ok(
    tapandoUna < analisis.lineasAlAnillo.length,
    "pero sí debería contarse como una menos"
  );

  // Y una casilla que no tapa nada las deja todas.
  assert.strictEqual(lineasAbiertasSi(analisis, "A1"), analisis.lineasAlAnillo.length);
});

prueba("los rasgos de cobertura y presencia caen en su casilla", () => {
  // Mismo cuidado que con los rasgos del castillo: insertar en mitad de la lista
  // desincroniza los nombres de las llamadas a `pon` sin dar ningún error.
  const indice = (nombre) => {
    const i = NOMBRES_RASGOS.indexOf(`jugada · ${nombre}`);
    assert.ok(i >= 0, `no existe el rasgo ${nombre}`);
    return i;
  };
  assert.strictEqual(NOMBRES_RASGOS.length, TAMANO_JUGADA, "hay más nombres que entradas o al revés");

  // Una sola línea, y una pieza que puede taparla del todo.
  const e = estadoVacio();
  const portador = colocar(e, "rojo", 5, "H6");
  portador.bandera = "rojo";
  e.banderas.rojo = { portador: portador.id, casilla: null, ultimoDueño: "rojo" };
  const canon = colocar(e, "verde", 1, "H12");
  const tapador = colocar(e, "rojo", 4, "G10");
  e.rangosRevelados = { [canon.id]: 1 };

  const ctx = contextoDeTurno(e, "rojo", analizarTurno(e, "rojo", DISTANCIA));
  const tapa = movimientosLegales(e, "rojo").find((a) => a.pieza === tapador.id && a.hasta === "H10");
  assert.ok(tapa, "G10 debería poder ir a H10");
  const v = rasgosDeJugada(e, "rojo", tapa, ctx);

  assert.strictEqual(v[indice("tapaLineaAlAnillo")], 1, "esa jugada tapa una línea");
  assert.strictEqual(v[indice("cubroLaUltimaLinea")], 1, "y era la única, así que la remata");
  assert.strictEqual(v[indice("anilloCubiertoTrasJugar")], 1, "el anillo queda cubierto del todo");

  // Una jugada que no tapa deja el anillo descubierto.
  const otra = movimientosLegales(e, "rojo").find((a) => a.pieza === tapador.id && a.hasta !== "H10");
  const w = rasgosDeJugada(e, "rojo", otra, ctx);
  assert.strictEqual(w[indice("cubroLaUltimaLinea")], 0, "esa no remata nada");
  assert.ok(w[indice("anilloCubiertoTrasJugar")] < 1, "y el anillo sigue batido");

  // La presencia va entre 0 y 1, y con dos míos contra uno suyo debe pasar de 0,5.
  const presencia = v[indice("presenciaEnElCentro")];
  assert.ok(presencia > 0.5 && presencia <= 1, `presencia fuera de rango o sin ventaja: ${presencia}`);
});


prueba("la sala de juicios enseña solo lo que vería quien mueve", () => {
  // Juzgar una jugada viendo los rangos escondidos del rival sería juzgar otro
  // juego, y la red aprendería de un consejo que ella nunca podrá seguir. Se ve
  // lo propio y, de los demás, solo lo ya revelado en combate — ni siquiera los
  // rangos del compañero, que es la regla de la partida.
  const e = estadoVacio();
  const mia = colocar(e, "rojo", 7, "H4");
  const socio = colocar(e, "azul", 9, "H13");
  const tapada = colocar(e, "verde", 8, "E7");
  const vista = colocar(e, "verde", 6, "K7");
  e.rangosRevelados = { [vista.id]: 6 };

  const ven = vistaDelEscenario(e, "rojo");
  const de = (id) => ven.find((p) => p.id === id);

  assert.strictEqual(de(mia.id).rango, 7, "la propia se ve entera");
  assert.strictEqual(de(socio.id).rango, null, "la del compañero NO");
  assert.strictEqual(de(tapada.id).rango, null, "una enemiga sin revelar tampoco");
  assert.strictEqual(de(vista.id).rango, 6, "la enemiga ya vista en combate sí");
  assert.strictEqual(de(vista.id).revelada, true, "y se marca como revelada");
  assert.strictEqual(de(mia.id).revelada, false, "la propia no es 'revelada', es mía");

  // Y lo importante: el rango escondido no viaja en ningún campo.
  const serializada = JSON.stringify(ven);
  assert.ok(!serializada.includes('"rango":8'), "el 8 escondido no debería aparecer por ningún lado");
  assert.ok(!serializada.includes('"rango":9'), "ni el 9 del compañero");
});


prueba("la red aprende un ORDEN con la pérdida por pares", () => {
  // Es lo que permite meter en la red cosas que no son un valor: una heurística
  // y un juicio humano dicen "esta jugada antes que esta", y ninguna de las dos
  // sabe decir "esta gana el 63% de las veces".
  //
  // La trampa que costó descubrirlo: la pérdida compara los LOGITS, y recuperar
  // el logit invirtiendo la sigmoide no vale. Con la salida saturada las dos
  // jugadas valen 1,0000, el recorte se come la diferencia y el gradiente pasa a
  // ser ruido: la primera versión aprendía el orden INVERTIDO, 18% de aciertos.
  const azar = (() => {
    let a = 7 >>> 0;
    return () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
  })();
  const red = crearRed([3, 6, 1], azar);
  // El primer rasgo manda; los otros dos son ruido que hay que ignorar.
  const par = () => {
    const a = azar(), b = azar();
    return {
      mejor: Float64Array.from([Math.max(a, b), azar(), azar()]),
      peor: Float64Array.from([Math.min(a, b), azar(), azar()]),
    };
  };
  const pares = Array.from({ length: 600 }, par);
  for (let e = 0; e < 150; e++) {
    for (let i = 0; i < pares.length; i += 32) entrenarPares(red, pares.slice(i, i + 32), { tasa: 0.02 });
  }

  let ok = 0;
  const n = 400;
  for (let i = 0; i < n; i++) {
    const p = par();
    if (evaluar(red, p.mejor) >= evaluar(red, p.peor)) ok++;
  }
  assert.ok(ok / n > 0.9, `el orden debería aprenderse; salió ${Math.round((100 * ok) / n)}%`);

  // Y el aviso que va con esto: la pérdida por pares SOLO mira diferencias, así
  // que dispara la escala de la salida y deja de ser una probabilidad. Aquí los
  // logits acaban en cientos. Por eso, cuando la red también tiene que valer
  // como estimación de victoria, hay que mezclarla con la pérdida de valor.
  const grande = adelante(red, Float64Array.from([0.9, 0.5, 0.5])).logit;
  assert.ok(Math.abs(grande) > 5, "sin pérdida de valor la escala se dispara, y conviene saberlo");
});


prueba("un hilo recortado no se reconstruye a medias, se declara imposible", () => {
  // El replay parte del despliegue inicial. Si al hilo le falta el principio no
  // sabe quién está dónde, y antes lo intentaba igual y devolvía rangos
  // EQUIVOCADOS: una partida de 221 turnos con el hilo recortado a 200 hacía que
  // una pieza llegada en el turno 41 apareciera de la nada.
  //
  // Devolver nulos es peor servicio y mejor respuesta: el informe deja esas
  // jugadas sin ficha en vez de mentir.
  const completo = [
    { n: 1, color: "rojo", tipo: "mover", desde: "H2", hasta: "H3", eventos: [] },
    { n: 2, color: "rojo", tipo: "mover", desde: "H3", hasta: "H4", eventos: [] },
  ];
  const despliegues = { rojo: [{ casilla: "H2", rango: 6 }] };
  assert.deepStrictEqual(reconstruirRangos(despliegues, completo), [6, 6], "entero sí se reconstruye");

  const recortado = completo.slice(1); // empieza en n=2
  assert.deepStrictEqual(
    reconstruirRangos(despliegues, recortado), [null],
    "recortado no debería inventarse nada"
  );
});


prueba("una partida terminada se reproduce exactamente", () => {
  // Es lo que hace posible analizar una partida: sin volver a montarla no se
  // puede preguntar qué habría pasado con otra jugada. Y tiene que salir EXACTA,
  // no parecida: si el replay se desvía, todo lo que se mida encima es de otra
  // partida.
  const generador = (semilla) => {
    let a = semilla >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  };

  for (const semilla of [8800, 15551, 42043]) {
    const azar = generador(semilla);
    const despliegues = {};
    for (const color of COLORES) despliegues[color] = despliegueAleatorio(color, azar);
    let e = nuevaPartida(despliegues, { primero: COLORES[Math.floor(azar() * 4)] });
    let turnos = 0;
    while (!e.fin && turnos < 300) {
      if (e.pendiente) {
        const p = e.pendiente;
        e = p.tipo === "recoger"
          ? (decisionDeRecogida(e, p.color) ? recogerLaBandera(e) : renunciarARecoger(e))
          : reclutar(e, Math.max(...p.opciones));
        continue;
      }
      const a = accionDeBot(e, e.turno, { azar });
      if (!a) break;
      e = aplicar(e, a);
      turnos++;
    }

    const { pasos, estadoFinal } = reproducirPartida(despliegues, e.historia);
    assert.strictEqual(pasos.length, e.historia.length, `semilla ${semilla}: faltan pasos`);
    assert.deepStrictEqual(estadoFinal.tablero, e.tablero, `semilla ${semilla}: el tablero final no coincide`);
    assert.deepStrictEqual(estadoFinal.fin, e.fin, `semilla ${semilla}: el final no coincide`);
    assert.deepStrictEqual(estadoFinal.marcador, e.marcador, `semilla ${semilla}: el marcador no coincide`);
  }
});

prueba("un hilo que no se puede reproducir lo dice, no lo intenta", () => {
  const despliegues = { rojo: [{ casilla: "H2", rango: 6 }] };
  assert.throws(() => reproducirPartida(despliegues, []), ReplayImposible, "hilo vacío");
  assert.throws(
    () => reproducirPartida(despliegues, [{ n: 7, color: "rojo", tipo: "mover", desde: "H2", hasta: "H3" }]),
    ReplayImposible,
    "hilo que empieza por la jugada 7"
  );
  // Y un reclutamiento sin rango: pasa si el hilo venía censurado.
  assert.throws(
    () => reproducirPartida(despliegues, [{ n: 1, color: "rojo", tipo: "reclutar", eventos: [] }]),
    ReplayImposible,
    "reclutamiento sin rango"
  );
});


prueba("un bot que puede coronar corona, pase lo que pase", () => {
  // Visto jugando: un bot que podía coronar movió otra pieza y ganó un turno más
  // tarde. No era la red ni la heurística: era el RUIDO de la dificultad. Medido
  // antes del arreglo, el nivel 3 dejaba de coronar el 42% de las veces y el 4
  // el 25%.
  //
  // Un nivel bajo tiene que jugar peor, no regalar partidas ganadas. Un humano
  // flojo hace jugadas mediocres; no pasa de largo por delante de la torre con
  // la bandera en la mano.
  const sembrado = (semilla) => {
    let a = semilla >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  };
  const escenario = () => {
    const e = estadoVacio();
    const portador = colocar(e, "rojo", 5, ANILLO_T);
    portador.bandera = "rojo";
    e.banderas.rojo = { portador: portador.id, casilla: null, ultimoDueño: "rojo" };
    colocar(e, "rojo", 4, "D4");
    colocar(e, "rojo", 6, "E5");
    colocar(e, "rojo", 3, "F6");
    colocar(e, "verde", 7, "K8");
    return e;
  };

  for (let i = 0; i < 200; i++) {
    const elegida = jugadaDeBot(escenario(), "rojo", {}, sembrado(i + 1));
    assert.strictEqual(
      elegida && elegida.hasta, TORRE,
      `azar ${i}: podía coronar y jugó otra cosa`
    );
  }
});

prueba("un bot no carga la bandera de su compañero", () => {
  // Desde que una bandera solo la corona una pieza de su color, cargar la del
  // compañero la CONGELA: quien la lleva no puede coronarla y su dueño ya no
  // puede recuperarla salvo que caiga en combate. Le quita al equipo una de sus
  // dos vías de ganar, y se vio pasar en una partida.
  const escenario = (deQuien) => {
    const e = estadoVacio();
    const pieza = colocar(e, "rojo", 5, "H4");
    e.banderasSueltas.H4 = deQuien;
    e.banderas[deQuien] = { portador: null, casilla: "H4", ultimoDueño: deQuien };
    e.pendiente = { tipo: "recoger", color: "rojo", pieza: pieza.id, casilla: "H4", bandera: deQuien };
    return e;
  };
  assert.strictEqual(decisionDeRecogida(escenario("rojo"), "rojo"), true, "la propia sí: es la que uno corona");
  assert.strictEqual(decisionDeRecogida(escenario("azul"), "rojo"), false, "la del compañero NO: la dejaría inservible");
  assert.strictEqual(decisionDeRecogida(escenario("verde"), "rojo"), true, "una enemiga sí: da promoción");

  // EL MATIZ: renunciar solo protege la bandera mientras el que la tapa aguante.
  // Con un enemigo al lado que me gana, quien vence avanza a mi casilla, cae
  // sobre la bandera y se la lleva; la renuncia no la ha protegido, la ha
  // entregado. Cargarla es malo -queda congelada- pero se la puede llevar lejos.
  const conAmenaza = escenario("azul");
  const general = colocar(conAmenaza, "verde", 8, "I4");
  conAmenaza.rangosRevelados = { [general.id]: 8 };
  assert.strictEqual(
    decisionDeRecogida(conAmenaza, "rojo"),
    true,
    "con un general enemigo revelado al lado que se lleva por delante a mi 5, cargarla es menos malo que regalarla"
  );

  // Y si el enemigo de al lado NO me gana, se mantiene la regla: no se carga.
  const sinAmenaza = escenario("azul");
  const explorador = colocar(sinAmenaza, "verde", 2, "I4");
  sinAmenaza.rangosRevelados = { [explorador.id]: 2 };
  assert.strictEqual(
    decisionDeRecogida(sinAmenaza, "rojo"),
    false,
    "contra un enemigo revelado que pierde, el 5 aguanta encima y la bandera sigue viva para su dueño"
  );
});


prueba("gastar el cañón cuesta, así que un explorador no compensa", () => {
  // Visto en partida: un cañón gastado sobre un explorador ya identificado. El
  // disparo se valoraba por el rango del objetivo y no descontaba lo que vale la
  // pieza que se gasta, que es la única capaz de llevarse por delante cualquier
  // cosa y la única que alcanza el castillo desde fuera.
  const nota = (rango) => PESOS_BASE.costeDelCanon + PESOS_BASE.disparoConocidoBase + rango * PESOS_BASE.disparoConocidoFactor;
  assert.ok(nota(3) < nota(6), "batir a un capitán tiene que valer más que a un explorador");
  assert.ok(nota(2) <= 0, "contra un rango bajo no debería compensar gastar el cañón");
  // Contra un mariscal son 28 puntos, que compiten de sobra con una jugada
  // normal; lo que importa es la DISTANCIA con el disparo barato, no el número
  // suelto.
  assert.ok(nota(9) > 20, `contra un mariscal tiene que seguir compensando; salió ${nota(9)}`);
  assert.ok(nota(9) - nota(3) > 30, "y la diferencia con un explorador tiene que ser grande");

  // Y parar una coronación sigue por encima de todo: el coste no puede
  // convertir en dudosa la jugada que evita perder la partida.
  assert.ok(PESOS_BASE.disparoAlCoronador + nota(3) > 300, "parar una coronación manda sobre el coste");
});


prueba("un modelo con otra activación se rechaza aunque todo lo demás cuadre", () => {
  // Al pasar de ReLU a leaky ReLU, un modelo viejo se carga sin protestar y
  // calcula OTRA COSA: mismos pesos, distinta función. No da error, no falla
  // ninguna prueba, y el bot juega con basura — la misma trampa que la firma de
  // los rasgos.
  //
  // El cambio no fue capricho: con ReLU seca las neuronas se morían en masa. En
  // la red de despliegue disparaba 1 de 16 y en la de jugada 4 de 28, así que
  // una red 83->16->1 era en la práctica 83->1->1.
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "reuter4-activacion-"));
  const modelo = {
    firmaRasgos: FIRMA_JUGADA,
    activacion: "relu",
    red: { capas: [TAMANO_JUGADA, 3, 1], pesos: [], sesgos: [] },
  };
  fs.writeFileSync(path.join(carpeta, "red-jugada.json"), JSON.stringify(modelo));
  const cargado = cargarModelos(carpeta);
  assert.strictEqual(cargado.jugada, null, "un modelo con otra activación no puede cargarse");
  assert.ok(
    cargado.notas.some((n) => n.includes("activación")),
    "y tiene que decir que es por la activación, no dejarlo a adivinar"
  );

  // Con la activación buena, el mismo modelo pasa esa comprobación.
  fs.writeFileSync(path.join(carpeta, "red-jugada.json"), JSON.stringify({ ...modelo, activacion: ACTIVACION }));
  assert.ok(
    !cargarModelos(carpeta).notas.some((n) => n.includes("activación")),
    "con la activación correcta no debería quejarse de eso"
  );
  fs.rmSync(carpeta, { recursive: true, force: true });
});

prueba("la clave de un juicio de despliegue se vuelve a leer sin ambigüedad", async () => {
  // La clave lleva dentro la colocación entera para que los juicios sobrevivan
  // a regenerar las parejas. Pero la casilla acaba en dígito y el rango ES un
  // dígito: sin separador, "E13" seguido de un 2 se lee igual como (E13, 2) que
  // como (E1, 32). Eso no daría error: entrenaría con un despliegue que no es
  // el que se juzgó, y no habría forma de notarlo.
  const { colocacionDesdeClave } = await import("../../entrenamiento/juicios.mjs");

  const leido = colocacionDesdeClave("rojo:E1-3,E13-2,O15-9");
  assert.strictEqual(leido.color, "rojo");
  assert.deepStrictEqual(leido.colocacion, [
    { casilla: "E1", rango: 3 },
    { casilla: "E13", rango: 2 },
    { casilla: "O15", rango: 9 },
  ]);

  // Y la ida y vuelta completa sobre un despliegue de verdad, con sus veinte
  // piezas: es la única garantía de que lo que entrena es lo que se juzgó.
  const colocacion = despliegueAleatorio("rojo", Math.random);
  const clave = "rojo:" + colocacion.slice().sort((x, y) => (x.casilla < y.casilla ? -1 : 1)).map((p) => `${p.casilla}-${p.rango}`).join(",");
  const vuelta = colocacionDesdeClave(clave);
  assert.strictEqual(vuelta.colocacion.length, colocacion.length, "no puede perder piezas por el camino");
  for (const pieza of colocacion) {
    assert.ok(
      vuelta.colocacion.some((q) => q.casilla === pieza.casilla && q.rango === pieza.rango),
      `${pieza.casilla} de rango ${pieza.rango} tendría que sobrevivir a la ida y vuelta`
    );
  }
});


prueba("los rasgos de defensa no salen muertos ni constantes", async () => {
  // EL FALLO RECURRENTE del proyecto: un rasgo que se calcula mal no da error,
  // no rompe nada y se queda a cero para siempre. Ya pasó con `juntoALago`
  // (nueve veces muerto), con `zonaFavorable`, y con estos tres, que salieron al
  // 0,0% por usar DISTANCIA -que mide al CASTILLO, no entre dos casillas- y por
  // leer coord() como si devolviera {columna,fila} cuando devuelve un array.
  //
  // Un rasgo por debajo del 1% no da gradiente y la red lo ignora, así que
  // "vivo" es un umbral, no una comprobación de que no sea cero.
  const { entradasDeJugada } = await import("../../entrenamiento/sensibilidad.mjs");
  const { NOMBRES } = await import("./rasgos-jugada.js");
  const vectores = entradasDeJugada({ partidas: 4, cadaTurnos: 5, porTurno: 8 });
  assert.ok(vectores.length > 200, `hacen falta jugadas para medir; salieron ${vectores.length}`);

  for (const nombre of ["riesgoConDesconocido", "defiendoMiBandera", "bloqueoLateral"]) {
    const i = NOMBRES.indexOf(`jugada · ${nombre}`);
    assert.ok(i >= 0, `${nombre} tiene que estar en NOMBRES`);
    const valores = vectores.map((v) => v[i]);
    const activas = valores.filter((x) => x !== 0).length / valores.length;
    assert.ok(activas > 0.01, `${nombre} se activa en el ${(activas * 100).toFixed(2)}%, por debajo del 1% la red lo ignora`);
    assert.ok(activas < 0.95, `${nombre} se activa en el ${(activas * 100).toFixed(1)}%: casi constante, tampoco distingue`);
    assert.ok(valores.every((x) => x >= 0 && x <= 1), `${nombre} tiene que estar normalizado a [0,1]`);
  }
});

prueba("pesar un ejemplo equivale a repetirlo, y cuesta una pasada en vez de N", async () => {
  // De esto depende la optimización que quitó el 51% del coste de entrenar: el
  // banco de escenarios se metía cuarenta veces en el conjunto para que contase
  // cuarenta veces. Si pesar NO fuera equivalente a repetir, estaríamos
  // entrenando otra cosa distinta y más rápido, que no es la idea.
  const { crearRed, entrenarLote, aObjeto, desdeObjeto } = await import("../../entrenamiento/red.mjs");

  const azar = (() => { let x = 12345; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const semilla = aObjeto(crearRed([4, 3, 1], azar));
  const ejemplos = Array.from({ length: 5 }, (_, i) => ({
    entrada: Float64Array.from([i * 0.3, 1 - i * 0.2, 0.5, i % 2]),
    objetivo: i % 2,
  }));

  // Con copias: el tercer ejemplo aparece siete veces.
  const conCopias = [];
  for (const [i, ej] of ejemplos.entries()) {
    for (let k = 0; k < (i === 2 ? 7 : 1); k++) conCopias.push(ej);
  }
  // Con peso: aparece una vez y pesa siete.
  const conPeso = ejemplos.map((ej, i) => (i === 2 ? { ...ej, peso: 7 } : ej));

  const redA = desdeObjeto(semilla);
  const redB = desdeObjeto(semilla);
  entrenarLote(redA, conCopias, { tasa: 0.05 });
  entrenarLote(redB, conPeso, { tasa: 0.05 });

  const a = aObjeto(redA);
  const b = aObjeto(redB);
  for (let c = 0; c < a.pesos.length; c++) {
    for (let k = 0; k < a.pesos[c].length; k++) {
      assert.ok(
        Math.abs(a.pesos[c][k] - b.pesos[c][k]) < 1e-12,
        `capa ${c} peso ${k}: repetir dio ${a.pesos[c][k]} y pesar ${b.pesos[c][k]}`
      );
    }
  }
  assert.strictEqual(conCopias.length, 11, "la versión con copias hace 11 pasadas hacia delante");
  assert.strictEqual(conPeso.length, 5, "la de pesos hace 5, y sale lo mismo");
});


prueba("dos banderas caídas en la misma casilla no se comen la una a la otra", () => {
  // Visto jugando: caen dos portadores en el mismo sitio y solo queda una
  // bandera recogible. La otra no es que esté escondida, es que ha DESAPARECIDO
  // del estado y no se puede recoger nunca más.
  //
  // Pasa fácil en el anillo, que es una sola casilla lógica donde se concentra
  // todo el combate del final.
  const e = estadoVacio();
  // En G4 ya hay una bandera amarilla en el suelo, de un portador que cayó antes.
  e.banderasSueltas["G4"] = ["amarillo"];
  e.banderas.amarillo = { portador: null, casilla: "G4", ultimoDueño: "amarillo" };
  // Y ahí mismo está un portador verde, que va a caer. Verde y amarillo son
  // equipo, y los dos son enemigos del rojo que ataca.
  const portador = colocar(e, "verde", 3, "G4");
  portador.bandera = "verde";
  e.banderas.verde = { portador: portador.id, casilla: null, ultimoDueño: "verde" };
  colocar(e, "rojo", 9, "G3");

  let tras = aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === "G4" && a.tipo === "atacar"));
  while (tras.pendiente) tras = renunciarARecoger(tras);

  const sueltas = tras.banderasSueltas["G4"];
  const cuantas = Array.isArray(sueltas) ? sueltas.length : sueltas ? 1 : 0;
  assert.strictEqual(
    cuantas, 2,
    `en G4 tendría que haber DOS banderas caídas y hay ${cuantas}: ${JSON.stringify(sueltas)}`
  );
});


prueba("de un montón de banderas se pueden recoger las dos, una por pieza", () => {
  // Guardarlas las dos no sirve de nada si luego solo se puede coger una. Una
  // pieza carga una sola bandera, así que hacen falta dos piezas — y la segunda
  // tiene que encontrar todavía la que quedó.
  const e = estadoVacio();
  e.banderasSueltas["G4"] = ["amarillo", "verde"];
  e.banderas.amarillo = { portador: null, casilla: "G4", ultimoDueño: "amarillo" };
  e.banderas.verde = { portador: null, casilla: "G4", ultimoDueño: "verde" };
  colocar(e, "rojo", 4, "H4");
  colocar(e, "rojo", 5, "G3");

  const primera = recogerLaBandera(aplicar(e, accion(movimientosLegales(e), (a) => a.hasta === "G4")));
  const conBandera = Object.values(primera.piezas).filter((p) => p.bandera);
  assert.strictEqual(conBandera.length, 1, "la primera pieza carga una sola bandera");
  assert.deepStrictEqual(
    primera.banderasSueltas["G4"], ["verde"],
    "y en el suelo tiene que quedar la otra"
  );

  // La primera se aparta y la segunda va a por la que queda. Se fuerza el turno:
  // lo que se prueba es que la bandera siga ahí, no el orden de los turnos.
  const cargada = Object.values(primera.piezas).find((p) => p.bandera);
  const libre = aplicar({ ...primera, turno: "rojo" }, { tipo: "mover", pieza: cargada.id, desde: "G4", hasta: "F4" });
  const otra = Object.values(libre.piezas).find((p) => p.casilla === "G3");
  const segunda = recogerLaBandera(
    aplicar({ ...libre, turno: "rojo" }, { tipo: "mover", pieza: otra.id, desde: "G3", hasta: "G4" })
  );
  const cargadas = Object.values(segunda.piezas).filter((p) => p.bandera).map((p) => p.bandera).sort();
  assert.deepStrictEqual(cargadas, ["amarillo", "verde"], "las dos banderas acaban cargadas");
  assert.strictEqual(segunda.banderasSueltas["G4"], undefined, "y el suelo queda limpio");
});


console.log(`\n${pasadas} pruebas superadas, ${fallidas} fallidas\n`);
process.exit(fallidas ? 1 : 0);
