// Servidor de Reuter4: guarda el estado completo y reparte a cada cliente
// solo lo que su bando puede ver. Los rangos ajenos no salen de aquí.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { COLORES, ZONAS } from "../src/motor/tablero.js";
import {
  nuevaPartida,
  aplicar,
  reclutar,
  recogerLaBandera,
  renunciarARecoger,
  validarDespliegue,
} from "../src/motor/motor.js";
import { accionDeBot, decisionDeRecogida, despliegueAleatorio } from "../src/motor/bot.js";
import { accionConRed, despliegueGuiado, cargarModelos } from "../src/motor/bot-red.js";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));

// Los modelos entrenados, cargados una vez al arrancar. Si no están o están
// obsoletos, `cargarModelos` devuelve nulos y los bots juegan con la heurística
// de siempre: el juego tiene que funcionar igual sin ellos, porque durante la
// mayor parte de la vida del proyecto funcionó así.
const MODELOS = cargarModelos();
for (const nota of MODELOS.notas) console.log(`  red de ${nota}`);

// Cómo despliega y cómo mueve un bot. Un solo sitio, para que la partida real y
// lo que se mide en el entrenamiento sean lo mismo.
const desplegarBot = (color) =>
  MODELOS.despliegue ? despliegueGuiado(color, Math.random, MODELOS.despliegue, 30, 200) : despliegueAleatorio(color);
const moverBot = (estado, color) =>
  MODELOS.jugada ? accionConRed(estado, color, MODELOS.jugada, { candidatas: 12 }) : accionDeBot(estado, color);
const ESTATICO = path.join(RAIZ, "..", "dist");
const PUERTO = process.env.PORT || 8080;
const FICHERO_ESTADO = process.env.R4_ESTADO || path.join(RAIZ, "salas.json");

// Los bots viven en src/motor/bot.js, compartidos con la simulación: así lo que
// mide `npm run simular` es exactamente lo que juega este servidor.

// --- Salas ------------------------------------------------------------------

let salas = {};
try {
  if (fs.existsSync(FICHERO_ESTADO)) salas = JSON.parse(fs.readFileSync(FICHERO_ESTADO, "utf8"));
} catch (e) {
  salas = {};
}

let guardadoPendiente = null;
function persistir() {
  if (guardadoPendiente) return;
  guardadoPendiente = setTimeout(() => {
    guardadoPendiente = null;
    fs.writeFile(FICHERO_ESTADO, JSON.stringify(salas), () => {});
  }, 1500);
}

const idAleatorio = (p) => p + "_" + Math.random().toString(36).slice(2, 9);

function huella(texto) {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function colorDe(sala, idJugador) {
  return COLORES.find((c) => sala.puestos[c] && sala.puestos[c].id === idJugador) || null;
}

// Cuántas jugadas del hilo se mandan. `repartir` reenvía todas las salas a todos
// los clientes en cada cambio, así que el historial completo de cada sala se
// multiplicaría en cada mensaje. Se manda solo la cola, y solo a quien juega.
const HISTORIA_ENVIADA = 80;

// Lo que se manda a cada cliente: rangos propios, bajas propias, nada más.
function salaParaJugador(sala, idJugador) {
  const miColor = colorDe(sala, idJugador);
  const base = {
    id: sala.id,
    nombre: sala.nombre,
    anfitrion: sala.anfitrion,
    privada: sala.privada,
    fase: sala.fase,
    puestos: sala.puestos,
    creada: sala.creada,
    desplegados: COLORES.filter((c) => sala.despliegues[c]),
    miColor,
  };
  if (!sala.estado) return base;
  const e = sala.estado;
  return {
    ...base,
    estado: {
      turno: e.turno,
      fin: e.fin,
      eventos: e.eventos,
      // El hilo solo contiene lo que ya se emitió como evento: jugadas, duelos y
      // banderas. Ningún rango oculto, así que se puede mandar tal cual.
      historia: miColor ? (e.historia || []).slice(-HISTORIA_ENVIADA) : [],
      // Rangos que ya ha visto toda la mesa. Es lo mismo que se deduce leyendo el
      // hilo, así que enviarlo no destapa nada; de momento el cliente no lo pinta.
      banderasSueltas: e.banderasSueltas,
      marcador: e.marcador,
      misBajas: miColor ? e.bajas[miColor] : [],
      pendiente: e.pendiente && e.pendiente.color === miColor ? e.pendiente : null,
      piezas: Object.fromEntries(
        Object.entries(e.piezas).map(([id, p]) => [
          id,
          p.color === miColor
            ? { id, color: p.color, casilla: p.casilla, bandera: p.bandera, rango: p.rango, ultimoTramo: p.ultimoTramo, alternancias: p.alternancias }
            : { id, color: p.color, casilla: p.casilla, bandera: p.bandera, rango: null },
        ])
      ),
    },
  };
}

function repartir() {
  for (const [socket, sesion] of clientes) {
    if (socket.readyState !== 1 || !sesion.id) continue;
    const vista = Object.fromEntries(
      Object.entries(salas).map(([id, sala]) => [id, salaParaJugador(sala, sesion.id)])
    );
    socket.send(JSON.stringify({ tipo: "salas", salas: vista }));
  }
  persistir();
}

// --- Ciclo de los bots ------------------------------------------------------

function esAutomatico(sala, color) {
  const puesto = sala.puestos[color];
  if (!puesto) return false;
  if (puesto.tipo === "bot") return true;
  // Si un humano lleva más de un minuto desconectado, la máquina juega por él.
  return puesto.desconectadoDesde && Date.now() - puesto.desconectadoDesde > 60000;
}

// Resuelve en cadena las decisiones que le tocan a un puesto automático. Una
// sola jugada puede encadenar dos: recoger una bandera y luego reclutar.
function resolverPendientesDeBots(sala, estadoInicial) {
  let estado = estadoInicial;
  let vueltas = 0;
  while (estado.pendiente && !estado.fin && esAutomatico(sala, estado.pendiente.color)) {
    if (++vueltas > 8) break; // cinturón: nunca debería encadenar tanto
    const pendiente = estado.pendiente;
    if (pendiente.tipo === "recoger") {
      estado = decisionDeRecogida(estado, pendiente.color)
        ? recogerLaBandera(estado)
        : renunciarARecoger(estado);
    } else if (pendiente.tipo === "reclutar") {
      estado = reclutar(estado, Math.max(...pendiente.opciones));
    } else {
      break;
    }
  }
  return estado;
}

setInterval(() => {
  let cambios = false;
  for (const sala of Object.values(salas)) {
    if (sala.fase === "desplegando") {
      for (const color of COLORES) {
        if (esAutomatico(sala, color) && !sala.despliegues[color]) {
          sala.despliegues[color] = desplegarBot(color);
          cambios = true;
        }
      }
      if (COLORES.every((c) => sala.despliegues[c])) {
        try {
          sala.estado = nuevaPartida(sala.despliegues, { primero: COLORES[Math.floor(Math.random() * 4)] });
          sala.fase = "jugando";
          cambios = true;
        } catch (e) {
          console.error("despliegue inválido:", e.message);
        }
      }
      continue;
    }

    if (sala.fase !== "jugando" || !sala.estado || sala.estado.fin) continue;
    try {
      // Una decisión pendiente congela la partida entera, así que va primero y
      // sin mirar de quién es el turno: quien decide no siempre es quien acaba
      // de jugar, porque el defensor que gana también asciende.
      if (sala.estado.pendiente) {
        if (!esAutomatico(sala, sala.estado.pendiente.color)) continue;
        sala.estado = resolverPendientesDeBots(sala, sala.estado);
      } else {
        const turno = sala.estado.turno;
        if (!esAutomatico(sala, turno)) continue;
        const accion = moverBot(sala.estado, turno);
        if (!accion) continue;
        sala.estado = resolverPendientesDeBots(sala, aplicar(sala.estado, accion));
      }
      if (sala.estado.fin) sala.fase = "fin";
      sala.actualizada = Date.now();
      cambios = true;
    } catch (e) {
      console.error("bot atascado:", e.message);
    }
  }
  if (cambios) repartir();
}, 1200);

// Limpieza de salas viejas
setInterval(() => {
  const ahora = Date.now();
  let cambios = false;
  for (const [id, sala] of Object.entries(salas)) {
    if (ahora - (sala.actualizada || 0) > 12 * 60 * 60 * 1000) {
      delete salas[id];
      cambios = true;
    }
  }
  if (cambios) repartir();
}, 60000);

// --- HTTP y WebSocket -------------------------------------------------------

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const servidor = http.createServer((peticion, respuesta) => {
  const url = (peticion.url || "/").split("?")[0];
  let fichero = path.join(ESTATICO, url === "/" ? "index.html" : url);
  if (!fichero.startsWith(ESTATICO)) {
    respuesta.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(fichero) || fs.statSync(fichero).isDirectory()) fichero = path.join(ESTATICO, "index.html");
  if (!fs.existsSync(fichero)) {
    respuesta.writeHead(404).end("Compila antes el cliente: npm run build");
    return;
  }
  respuesta.writeHead(200, { "Content-Type": TIPOS[path.extname(fichero)] || "application/octet-stream" });
  fs.createReadStream(fichero).pipe(respuesta);
});

const wss = new WebSocketServer({ server: servidor, path: "/ws" });
const clientes = new Map();

function error(socket, texto) {
  socket.send(JSON.stringify({ tipo: "error", texto }));
}

wss.on("connection", (socket) => {
  clientes.set(socket, { id: null, nombre: null });

  socket.on("message", (bruto) => {
    let mensaje;
    try {
      mensaje = JSON.parse(bruto.toString());
    } catch (e) {
      return;
    }
    const sesion = clientes.get(socket);

    if (mensaje.tipo === "hola") {
      sesion.id = String(mensaje.id || idAleatorio("j")).slice(0, 40);
      sesion.nombre = String(mensaje.nombre || "Anónimo").slice(0, 18);
      for (const sala of Object.values(salas)) {
        const color = colorDe(sala, sesion.id);
        if (color) delete sala.puestos[color].desconectadoDesde;
      }
      socket.send(JSON.stringify({ tipo: "identidad", id: sesion.id, nombre: sesion.nombre }));
      repartir();
      return;
    }
    if (!sesion.id) return;

    if (mensaje.tipo === "crear") {
      const id = idAleatorio("s");
      const ahora = Date.now();
      salas[id] = {
        id,
        nombre: String(mensaje.nombre || `Campaña de ${sesion.nombre}`).slice(0, 40),
        anfitrion: sesion.id,
        privada: Boolean(mensaje.clave),
        clave: mensaje.clave ? huella(String(mensaje.clave)) : null,
        fase: "esperando",
        puestos: { rojo: { tipo: "humano", id: sesion.id, nombre: sesion.nombre }, verde: null, azul: null, amarillo: null },
        despliegues: {},
        estado: null,
        creada: ahora,
        actualizada: ahora,
      };
      repartir();
      return;
    }

    const sala = mensaje.sala ? salas[mensaje.sala] : null;
    if (!sala) return;
    const miColor = colorDe(sala, sesion.id);

    if (mensaje.tipo === "unirse") {
      if (miColor) return repartir();
      if (sala.privada && huella(String(mensaje.clave || "")) !== sala.clave) return error(socket, "Contraseña incorrecta.");
      if (sala.fase !== "esperando") return error(socket, "Esa partida ya ha empezado.");
      const hueco = COLORES.find((c) => !sala.puestos[c]);
      if (!hueco) return error(socket, "No quedan puestos libres.");
      sala.puestos[hueco] = { tipo: "humano", id: sesion.id, nombre: sesion.nombre };
      sala.actualizada = Date.now();
      return repartir();
    }

    if (mensaje.tipo === "bot" || mensaje.tipo === "librar" || mensaje.tipo === "empezar") {
      if (sala.anfitrion !== sesion.id) return error(socket, "Solo el anfitrión puede hacer eso.");
      if (mensaje.tipo === "bot" && !sala.puestos[mensaje.color]) {
        const usados = COLORES.map((c) => sala.puestos[c]).filter(Boolean).map((p) => p.nombre);
        const nombres = ["Ney", "Davout", "Murat", "Soult", "Masséna", "Lannes"];
        const libre = nombres.find((n) => !usados.includes(`Mariscal ${n}`)) || "Bonaparte";
        sala.puestos[mensaje.color] = { tipo: "bot", id: idAleatorio("b"), nombre: `Mariscal ${libre}` };
      }
      if (mensaje.tipo === "librar" && sala.puestos[mensaje.color] && sala.puestos[mensaje.color].tipo === "bot") {
        sala.puestos[mensaje.color] = null;
      }
      if (mensaje.tipo === "empezar") {
        if (!COLORES.every((c) => sala.puestos[c])) return error(socket, "Faltan puestos por cubrir.");
        sala.fase = "desplegando";
      }
      sala.actualizada = Date.now();
      return repartir();
    }

    // Parar y borrar son cosas distintas: parar cierra la partida pero deja la
    // sala en pie para poder repasar el hilo y el resultado; borrar la hace
    // desaparecer para todos. Las dos son solo de quien creó la partida.
    if (mensaje.tipo === "parar" || mensaje.tipo === "borrar") {
      if (sala.anfitrion !== sesion.id) {
        return error(socket, "Solo quien creó la partida puede pararla o borrarla.");
      }
      if (mensaje.tipo === "borrar") {
        delete salas[sala.id];
        return repartir();
      }
      if (sala.fase === "fin") return error(socket, "Esa partida ya está cerrada.");
      if (sala.estado) {
        sala.estado.fin = { ganador: null, motivo: "la ha parado quien la creó" };
      }
      sala.fase = "fin";
      sala.actualizada = Date.now();
      return repartir();
    }

    if (mensaje.tipo === "despliegue") {
      if (!miColor || sala.fase !== "desplegando") return;
      const colocacion = Object.entries(mensaje.colocacion || {}).map(([casilla, rango]) => ({
        casilla,
        rango: Number(rango),
        bandera: casilla === ZONAS[miColor].bandera,
      }));
      const errores = validarDespliegue(miColor, colocacion);
      if (errores.length) return error(socket, errores[0]);
      sala.despliegues[miColor] = colocacion;
      sala.actualizada = Date.now();
      return repartir();
    }

    if (mensaje.tipo === "accion") {
      if (!miColor || !sala.estado || sala.estado.turno !== miColor) return error(socket, "No es tu turno.");
      try {
        sala.estado = aplicar(sala.estado, mensaje.accion);
        if (sala.estado.fin) sala.fase = "fin";
        sala.actualizada = Date.now();
        repartir();
      } catch (e) {
        error(socket, e.message);
      }
      return;
    }

    if (mensaje.tipo === "recoger") {
      const pendiente = sala.estado && sala.estado.pendiente;
      if (!miColor || !pendiente || pendiente.tipo !== "recoger" || pendiente.color !== miColor) return;
      try {
        sala.estado = mensaje.recoge ? recogerLaBandera(sala.estado) : renunciarARecoger(sala.estado);
        if (sala.estado.fin) sala.fase = "fin";
        sala.actualizada = Date.now();
        repartir();
      } catch (e) {
        error(socket, e.message);
      }
      return;
    }

    if (mensaje.tipo === "reclutar") {
      if (!miColor || !sala.estado || !sala.estado.pendiente || sala.estado.pendiente.color !== miColor) return;
      try {
        sala.estado = reclutar(sala.estado, Number(mensaje.rango));
        sala.actualizada = Date.now();
        repartir();
      } catch (e) {
        error(socket, e.message);
      }
      return;
    }

    if (mensaje.tipo === "salir") {
      if (!miColor) return;
      if (sala.fase === "esperando") sala.puestos[miColor] = null;
      else sala.puestos[miColor] = { ...sala.puestos[miColor], desconectadoDesde: Date.now() - 60000 };
      if (!COLORES.some((c) => sala.puestos[c] && sala.puestos[c].tipo === "humano")) delete salas[sala.id];
      else if (sala.anfitrion === sesion.id) {
        const relevo = COLORES.map((c) => sala.puestos[c]).find((p) => p && p.tipo === "humano");
        if (relevo) sala.anfitrion = relevo.id;
      }
      repartir();
    }
  });

  socket.on("close", () => {
    const sesion = clientes.get(socket);
    clientes.delete(socket);
    if (!sesion || !sesion.id) return;
    const sigueConectado = [...clientes.values()].some((s) => s.id === sesion.id);
    if (sigueConectado) return;
    for (const sala of Object.values(salas)) {
      const color = colorDe(sala, sesion.id);
      if (!color) continue;
      if (sala.fase === "esperando") sala.puestos[color] = null;
      else sala.puestos[color].desconectadoDesde = Date.now();
    }
    for (const [id, sala] of Object.entries(salas)) {
      if (sala.fase === "esperando" && !COLORES.some((c) => sala.puestos[c] && sala.puestos[c].tipo === "humano")) {
        delete salas[id];
      }
    }
    repartir();
  });
});

servidor.listen(PUERTO, () => {
  console.log(`Reuter4 escuchando en http://localhost:${PUERTO}`);
});
