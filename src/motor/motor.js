// Motor de reglas de Stratego 4. Sin gráficos: solo estado y transiciones.

import {
  ANILLO,
  TORRE,
  COLORES,
  ZONAS,
  ADYACENTES,
  DIRECCIONES,
  casillasDeZona,
  rayo,
} from "./tablero.js";

export const RANGOS = {
  9: { nombre: "Mariscal", cantidad: 1 },
  8: { nombre: "General", cantidad: 1 },
  7: { nombre: "Comandante", cantidad: 2 },
  6: { nombre: "Capitán", cantidad: 3 },
  5: { nombre: "Teniente", cantidad: 3 },
  4: { nombre: "Sargento", cantidad: 3 },
  3: { nombre: "Explorador", cantidad: 4 },
  2: { nombre: "Espía", cantidad: 1 },
  1: { nombre: "Cañón", cantidad: 2 },
};

export const MARISCAL = 9;
export const CAPITAN = 6;
export const EXPLORADOR = 3;
export const ESPIA = 2;
export const CANON = 1;

export const VICTORIAS_PARA_RECLUTAR = 6;
export const MAX_ALTERNANCIAS = 10; // 5 idas y 5 vueltas entre las mismas dos casillas

// Siempre se juega dos contra dos, con cada jugador enfrente de su compañero.
export const SOCIO = { rojo: "azul", azul: "rojo", verde: "amarillo", amarillo: "verde" };
export const EQUIPOS = [["rojo", "azul"], ["verde", "amarillo"]];

export function equipoDe(color) {
  return EQUIPOS.find((e) => e.includes(color));
}

export function inventarioInicial() {
  const piezas = [];
  for (const [rango, info] of Object.entries(RANGOS)) {
    for (let i = 0; i < info.cantidad; i++) piezas.push(Number(rango));
  }
  return piezas.sort((a, b) => b - a); // 20 piezas
}

function clonar(estado) {
  return JSON.parse(JSON.stringify(estado));
}

function sonAliados(estado, a, b) {
  return a === b || SOCIO[a] === b;
}

// --- Despliegue -------------------------------------------------------------

export function validarDespliegue(color, colocacion) {
  const errores = [];
  const zona = new Set(casillasDeZona(color));
  const reclutamiento = ZONAS[color].reclutamiento;
  const banderaCasilla = ZONAS[color].bandera;

  if (colocacion.length !== 20) errores.push(`Hacen falta 20 piezas, hay ${colocacion.length}.`);

  const ocupadas = new Set();
  for (const p of colocacion) {
    if (!zona.has(p.casilla)) errores.push(`${p.casilla} no pertenece a la zona de ${color}.`);
    if (p.casilla === reclutamiento) errores.push(`La casilla de reclutamiento ${reclutamiento} debe quedar libre.`);
    if (ocupadas.has(p.casilla)) errores.push(`Hay dos piezas en ${p.casilla}.`);
    ocupadas.add(p.casilla);
  }

  const esperado = inventarioInicial().slice().sort((a, b) => a - b).join(",");
  const puesto = colocacion.map((p) => p.rango).sort((a, b) => a - b).join(",");
  if (esperado !== puesto) errores.push("El reparto de rangos no coincide con las 20 piezas del juego.");

  const portadores = colocacion.filter((p) => p.bandera);
  if (portadores.length !== 1) errores.push("Exactamente una pieza debe llevar la bandera.");
  else if (portadores[0].casilla !== banderaCasilla) {
    errores.push(`La bandera debe empezar en ${banderaCasilla}.`);
  }

  return errores;
}

export function nuevaPartida(despliegues, opciones = {}) {
  const estado = {
    modo: "equipos",
    orden: [...COLORES],
    turno: opciones.primero && COLORES.includes(opciones.primero) ? opciones.primero : COLORES[0],
    piezas: {},
    tablero: {},
    banderas: {},
    banderasSueltas: {},
    marcador: {},
    bajas: {},
    pendiente: null,
    fin: null,
    eventos: [],
    contador: 0,
  };

  for (const color of COLORES) {
    estado.marcador[color] = 0;
    estado.bajas[color] = [];
    const errores = validarDespliegue(color, despliegues[color]);
    if (errores.length) throw new Error(`Despliegue de ${color}: ${errores.join(" ")}`);

    for (const p of despliegues[color]) {
      const id = `${color}-${++estado.contador}`;
      estado.piezas[id] = {
        id,
        color,
        rango: p.rango,
        casilla: p.casilla,
        bandera: p.bandera ? color : null,
        alternancias: 0,
        ultimoTramo: null,
      };
      estado.tablero[p.casilla] = id;
      if (p.bandera) {
        estado.banderas[color] = { portador: id, casilla: null, ultimoDueño: color };
      }
    }
  }
  return estado;
}

// --- Consultas --------------------------------------------------------------

export function piezaEn(estado, casilla) {
  const id = estado.tablero[casilla];
  return id ? estado.piezas[id] : null;
}

function llevaBandera(pieza) {
  return pieza.bandera !== null;
}

function pasosDeMovimiento(estado, pieza) {
  if (llevaBandera(pieza)) return 1;
  if (pieza.rango === EXPLORADOR) return Infinity;
  if (pieza.rango === CAPITAN) return 2;
  return 1;
}

export function movimientosLegales(estado, color = estado.turno) {
  if (estado.fin || estado.pendiente) return [];
  const acciones = [];
  const mias = Object.values(estado.piezas).filter((p) => p.color === color);

  for (const pieza of mias) {
    const alcance = pasosDeMovimiento(estado, pieza);

    if (alcance === Infinity) {
      // Explorador: recorre casillas libres en línea recta y puede atacar al final.
      for (const dir of Object.keys(DIRECCIONES)) {
        for (const paso of rayo(pieza.casilla, dir)) {
          if (paso.tipo === "lago") break; // el explorador no sobrevuela lagos
          const ocupante = piezaEn(estado, paso.casilla);
          if (!ocupante) {
            acciones.push({ tipo: "mover", pieza: pieza.id, desde: pieza.casilla, hasta: paso.casilla });
            if (paso.tipo === "castillo") break;
            continue;
          }
          if (!sonAliados(estado, ocupante.color, color)) {
            acciones.push({ tipo: "atacar", pieza: pieza.id, desde: pieza.casilla, hasta: paso.casilla });
          }
          break;
        }
      }
    } else {
      for (const vecina of ADYACENTES[pieza.casilla]) {
        const ocupante = piezaEn(estado, vecina);
        if (!ocupante) {
          acciones.push({ tipo: "mover", pieza: pieza.id, desde: pieza.casilla, hasta: vecina });
        } else if (!sonAliados(estado, ocupante.color, color) && pieza.rango !== CANON) {
          acciones.push({ tipo: "atacar", pieza: pieza.id, desde: pieza.casilla, hasta: vecina });
        }
      }
      if (alcance === 2) {
        // Capitán: segunda casilla, con giro. Si ataca en la primera, ahí acaba.
        for (const intermedia of ADYACENTES[pieza.casilla]) {
          if (piezaEn(estado, intermedia)) continue;
          for (const destino of ADYACENTES[intermedia]) {
            if (destino === pieza.casilla) continue;
            const ocupante = piezaEn(estado, destino);
            if (!ocupante) {
              acciones.push({ tipo: "mover", pieza: pieza.id, desde: pieza.casilla, hasta: destino, via: intermedia });
            } else if (!sonAliados(estado, ocupante.color, color)) {
              acciones.push({ tipo: "atacar", pieza: pieza.id, desde: pieza.casilla, hasta: destino, via: intermedia });
            }
          }
        }
      }
    }

    if (pieza.rango === CANON) {
      for (const dir of Object.keys(DIRECCIONES)) {
        for (const paso of rayo(pieza.casilla, dir, 3)) {
          if (paso.tipo === "lago") continue; // la bala sobrevuela el lago
          const ocupante = piezaEn(estado, paso.casilla);
          if (!ocupante) {
            if (paso.tipo === "castillo") break; // el castillo corta la línea de tiro
            continue;
          }
          if (!sonAliados(estado, ocupante.color, color)) {
            acciones.push({ tipo: "disparar", pieza: pieza.id, desde: pieza.casilla, hasta: paso.casilla });
          }
          break; // solo se puede batir a la primera pieza de la línea
        }
      }
    }
  }

  return acciones.filter((a) => !violaVaiven(estado, a));
}

function violaVaiven(estado, accion) {
  if (accion.tipo !== "mover") return false;
  const pieza = estado.piezas[accion.pieza];
  const tramo = pieza.ultimoTramo;
  if (!tramo) return false;
  const esRetorno = tramo.desde === accion.hasta && tramo.hasta === accion.desde;
  return esRetorno && pieza.alternancias + 1 > MAX_ALTERNANCIAS;
}

// --- Aplicación de acciones -------------------------------------------------

function registrarTramo(pieza, desde, hasta) {
  const tramo = pieza.ultimoTramo;
  if (tramo && tramo.desde === hasta && tramo.hasta === desde) pieza.alternancias += 1;
  else pieza.alternancias = 1;
  pieza.ultimoTramo = { desde, hasta };
}

function soltarBandera(estado, pieza) {
  if (!llevaBandera(pieza)) return;
  const color = pieza.bandera;
  pieza.bandera = null;
  estado.banderasSueltas[pieza.casilla] = color;
  estado.banderas[color].portador = null;
  estado.banderas[color].casilla = pieza.casilla;
}

function recogerBandera(estado, pieza) {
  const color = estado.banderasSueltas[pieza.casilla];
  if (!color || llevaBandera(pieza)) return null;
  delete estado.banderasSueltas[pieza.casilla];
  pieza.bandera = color;
  estado.banderas[color].portador = pieza.id;
  estado.banderas[color].casilla = null;
  return color;
}

function retirar(estado, pieza, { soltar = true } = {}) {
  if (soltar) soltarBandera(estado, pieza);
  delete estado.tablero[pieza.casilla];
  estado.bajas[pieza.color].push(pieza.rango);
  delete estado.piezas[pieza.id];
}

function mover(estado, pieza, destino) {
  delete estado.tablero[pieza.casilla];
  pieza.casilla = destino;
  estado.tablero[destino] = pieza.id;
}

function sumarVictoria(estado, color) {
  estado.marcador[color] += 1;
  if (estado.marcador[color] >= VICTORIAS_PARA_RECLUTAR) {
    estado.marcador[color] = 0; // solo la promoción por victorias reinicia el contador
    abrirReclutamiento(estado, color, "marcador");
  }
}

// La promoción por bandera no toca el marcador: ni lo sube ni lo reinicia.
function abrirReclutamiento(estado, color, motivo) {
  const casilla = ZONAS[color].reclutamiento;
  if (estado.tablero[casilla]) {
    estado.eventos.push({ tipo: "reclutamiento-fallido", color, motivo, razón: "casilla ocupada" });
    return;
  }
  if (estado.bajas[color].length === 0) {
    estado.eventos.push({ tipo: "reclutamiento-fallido", color, motivo, razón: "sin bajas que recuperar" });
    return;
  }
  estado.pendiente = { tipo: "reclutar", color, motivo, opciones: [...new Set(estado.bajas[color])].sort((a, b) => b - a) };
}

function comprobarVictoria(estado, pieza) {
  if (pieza.casilla !== TORRE || !llevaBandera(pieza)) return;
  // Corona cualquiera de las dos banderas del equipo: gana la pareja entera.
  if (!sonAliados(estado, pieza.bandera, pieza.color)) return;
  estado.fin = {
    ganador: pieza.color,
    equipo: equipoDe(pieza.color),
    bandera: pieza.bandera,
  };
  estado.eventos.push({ tipo: "victoria", color: pieza.color });
}

function resolverDuelo(atacante, defensor) {
  if (atacante.rango === ESPIA && defensor.rango === MARISCAL) return "atacante";
  if (atacante.rango === defensor.rango) return "empate";
  return atacante.rango > defensor.rango ? "atacante" : "defensor";
}

export function aplicar(estadoPrevio, accion) {
  if (estadoPrevio.fin) throw new Error("La partida ya ha terminado.");
  if (estadoPrevio.pendiente) throw new Error("Hay un reclutamiento pendiente de resolver.");

  const legales = movimientosLegales(estadoPrevio);
  const encaja = legales.find(
    (a) => a.tipo === accion.tipo && a.pieza === accion.pieza && a.hasta === accion.hasta && (a.via || null) === (accion.via || null)
  );
  if (!encaja) throw new Error("Acción ilegal.");

  const estado = clonar(estadoPrevio);
  estado.eventos = [];
  const pieza = estado.piezas[accion.pieza];

  if (accion.tipo === "mover") {
    registrarTramo(pieza, pieza.casilla, accion.hasta);
    mover(estado, pieza, accion.hasta);
    const recogida = recogerBandera(estado, pieza);
    if (recogida) {
      estado.eventos.push({ tipo: "bandera-recogida", color: pieza.color, bandera: recogida });
      const daPromocion =
        !sonAliados(estado, recogida, pieza.color) && estado.banderas[recogida].ultimoDueño === recogida;
      estado.banderas[recogida].ultimoDueño = pieza.color;
      if (daPromocion) abrirReclutamiento(estado, pieza.color, "bandera");
    }
    comprobarVictoria(estado, pieza);
  }

  if (accion.tipo === "disparar") {
    const objetivo = piezaEn(estado, accion.hasta);
    estado.eventos.push({
      tipo: "cañonazo",
      color: pieza.color,
      objetivo: { color: objetivo.color, rango: objetivo.rango, casilla: objetivo.casilla },
    });
    retirar(estado, objetivo);
    retirar(estado, pieza);
    sumarVictoria(estado, accion.color || pieza.color);
  }

  if (accion.tipo === "atacar") {
    const defensor = piezaEn(estado, accion.hasta);
    const resultado = resolverDuelo(pieza, defensor);
    estado.eventos.push({
      tipo: "duelo",
      atacante: { color: pieza.color, rango: pieza.rango },
      defensor: { color: defensor.color, rango: defensor.rango },
      resultado,
    });

    if (accion.via) registrarTramo(pieza, pieza.casilla, accion.via);

    if (resultado === "empate") {
      const casillaDefensor = defensor.casilla;
      retirar(estado, defensor);
      retirar(estado, pieza);
      estado.eventos.push({ tipo: "empate", casilla: casillaDefensor });
    } else if (resultado === "atacante") {
      const destino = defensor.casilla;
      const banderaCaida = defensor.bandera;
      retirar(estado, defensor); // suelta su bandera en la casilla
      const color = pieza.color;
      mover(estado, pieza, destino);
      sumarVictoria(estado, color);
      const recogida = recogerBandera(estado, pieza);
      if (recogida) {
        const eraDeSuDueño = estado.banderas[recogida].ultimoDueño === recogida;
        estado.banderas[recogida].ultimoDueño = color;
        estado.eventos.push({ tipo: "bandera-capturada", color, bandera: recogida });
        if (!sonAliados(estado, recogida, color) && eraDeSuDueño && !estado.pendiente) {
          abrirReclutamiento(estado, color, "bandera");
        }
      } else if (banderaCaida) {
        estado.eventos.push({ tipo: "bandera-en-el-suelo", bandera: banderaCaida, casilla: destino });
      }
      comprobarVictoria(estado, pieza);
    } else {
      const color = defensor.color;
      retirar(estado, pieza);
      sumarVictoria(estado, color);
    }
  }

  if (!estado.fin && !estado.pendiente) pasarTurno(estado);
  return estado;
}

export function reclutar(estado, rango) {
  if (!estado.pendiente || estado.pendiente.tipo !== "reclutar") throw new Error("No hay reclutamiento pendiente.");
  const siguiente = clonar(estado);
  const { color } = siguiente.pendiente;
  const indice = siguiente.bajas[color].indexOf(rango);
  if (indice === -1) throw new Error("Esa pieza no está entre tus bajas.");
  const casilla = ZONAS[color].reclutamiento;
  siguiente.bajas[color].splice(indice, 1);
  const id = `${color}-r${++siguiente.contador}`;
  siguiente.piezas[id] = { id, color, rango, casilla, bandera: null, alternancias: 0, ultimoTramo: null };
  siguiente.tablero[casilla] = id;
  siguiente.pendiente = null;
  siguiente.eventos = [{ tipo: "reclutamiento", color }]; // el rango no se publica
  pasarTurno(siguiente);
  return siguiente;
}

export function renunciarAlReclutamiento(estado) {
  const siguiente = clonar(estado);
  siguiente.pendiente = null;
  siguiente.eventos = [{ tipo: "reclutamiento-renunciado", color: estado.pendiente.color }];
  pasarTurno(siguiente);
  return siguiente;
}

function pasarTurno(estado) {
  const orden = estado.orden;
  let indice = orden.indexOf(estado.turno);
  for (let i = 0; i < orden.length; i++) {
    indice = (indice + 1) % orden.length;
    const candidato = orden[indice];
    if (movimientosLegales(estado, candidato).length > 0) {
      estado.turno = candidato;
      return;
    }
    estado.eventos.push({ tipo: "turno-saltado", color: candidato });
  }
  estado.fin = { ganador: null, motivo: "nadie tiene movimientos legales" };
}

// --- Vista por jugador ------------------------------------------------------
// Lo que un jugador puede ver: sus rangos, sus bajas, y de los demás solo posición y color.

export function vistaDe(estado, color) {
  // Ni siquiera el compañero ve tus rangos.
  const piezas = Object.values(estado.piezas).map((p) => {
    const propia = p.color === color;
    return {
      id: p.id,
      color: p.color,
      casilla: p.casilla,
      rango: propia ? p.rango : null,
      bandera: p.bandera,
    };
  });
  return {
    turno: estado.turno,
    equipo: equipoDe(color),
    fin: estado.fin,
    piezas,
    banderasSueltas: { ...estado.banderasSueltas },
    marcador: { ...estado.marcador },
    misBajas: [...estado.bajas[color]],
    pendiente: estado.pendiente && estado.pendiente.color === color ? estado.pendiente : null,
  };
}
