// Motor de reglas de Reuter4. Sin gráficos: solo estado y transiciones.

import {
  ANILLO,
  TORRE,
  COLORES,
  ZONAS,
  ADYACENTES,
  DIRECCIONES,
  casillasDeZona,
  rayo,
  BATEN_LA_TORRE,
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

// Cuántas jugadas se conservan en el hilo de historia. Es lo único del estado que
// crece sin tope natural, y el estado entero se serializa y se guarda en disco.
// Antes eran 200 y se quedaban cortas. El hilo no es solo para leerlo mientras
// se juega: es lo que permite REPRODUCIR una partida terminada, y un replay que
// empieza por el turno 21 no puede saber de qué rango es la pieza que ya estaba
// en F4. Pasó de verdad, en una partida de 221 turnos.
//
// Lo que se manda a los clientes sigue acotado aparte (`HISTORIA_ENVIADA`), así
// que esto solo hace crecer el estado guardado: unos 200 KB por sala en el peor
// caso, y las salas se borran a las 12 horas.
export const MAX_HISTORIA = 1200;

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

export function sonAliados(estado, a, b) {
  return a === b || SOCIO[a] === b;
}

// --- Registros públicos: rangos revelados e historia -------------------------
// Los escenarios de prueba y las salas guardadas por versiones anteriores del
// servidor no traen estos campos, así que se crean al vuelo cuando faltan.

function asegurarRegistros(estado) {
  if (!estado.rangosRevelados) estado.rangosRevelados = {};
  if (!estado.historia) estado.historia = [];
  if (!estado.colaPendientes) estado.colaPendientes = [];
  if (!estado.caidosPublicos) estado.caidosPublicos = {};
  if (!estado.reclutas) estado.reclutas = {};
  for (const color of COLORES) {
    if (!estado.caidosPublicos[color]) estado.caidosPublicos[color] = [];
    if (estado.reclutas[color] === undefined) estado.reclutas[color] = 0;
  }
}

// --- Cola de decisiones pendientes -------------------------------------------
// Una sola jugada puede abrir dos decisiones: recoger una bandera del suelo y,
// además, reclutar. `estado.pendiente` sigue siendo la que toca resolver ahora
// —es lo que ven el servidor y el cliente— y el resto espera turno en la cola.

function encolarPendiente(estado, pendiente, { alFrente = false } = {}) {
  if (!estado.pendiente) {
    estado.pendiente = pendiente;
    return;
  }
  if (alFrente) {
    estado.colaPendientes.unshift(estado.pendiente);
    estado.pendiente = pendiente;
    return;
  }
  estado.colaPendientes.push(pendiente);
}

// Se mantiene la regla de siempre: una jugada abre como mucho un reclutamiento.
function hayReclutamiento(estado) {
  if (estado.pendiente && estado.pendiente.tipo === "reclutar") return true;
  return estado.colaPendientes.some((p) => p.tipo === "reclutar");
}

// El llamante pone `pendiente` a null al resolver la suya y luego llama aquí.
// Si resolverla ha abierto otra decisión, esa manda; si no, se saca la siguiente
// de la cola; y si no queda ninguna, pasa turno.
function cerrarPendiente(estado) {
  if (!estado.pendiente) estado.pendiente = estado.colaPendientes.shift() || null;
  if (!estado.fin && !estado.pendiente) pasarTurno(estado);
}

function revelar(estado, id, rango) {
  estado.rangosRevelados[id] = rango;
}

// Quien sobrevive a un duelo enseña su rango a toda la mesa. En el empate no
// sobrevive nadie, y tras un cañonazo tampoco: se retiran los dos.
function revelarSuperviviente(estado, atacante, defensor, resultado) {
  if (resultado === "atacante") revelar(estado, atacante.id, atacante.rango);
  else if (resultado === "defensor") revelar(estado, defensor.id, defensor.rango);
}

// El movimiento delata por sí solo a dos rangos: solo el explorador recorre más
// de una casilla en línea, y solo el capitán encadena dos con giro.
function revelarPorMovimiento(estado, pieza, accion) {
  if (accion.tipo !== "mover") return;
  if (accion.via) revelar(estado, pieza.id, CAPITAN);
  else if (!ADYACENTES[accion.desde].includes(accion.hasta)) revelar(estado, pieza.id, EXPLORADOR);
}

// El hilo de historia guarda lo mismo que ya se emite en eventos, más la jugada
// que lo provocó. Nada de rangos ocultos: solo lo que la mesa ha visto.
function anotarEnHistoria(estado, entrada) {
  // La numeración sale de la última entrada, no de la longitud: al recortar el
  // hilo por arriba la longitud baja, pero las jugadas siguen contando.
  const ultima = estado.historia[estado.historia.length - 1];
  estado.historia.push({ n: (ultima ? ultima.n : 0) + 1, ...entrada });
  if (estado.historia.length > MAX_HISTORIA) {
    estado.historia.splice(0, estado.historia.length - MAX_HISTORIA);
  }
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
    colaPendientes: [],
    fin: null,
    eventos: [],
    // Rangos que han quedado a la vista de todos: los de quien sobrevive a un duelo
    // y los que delata el propio movimiento. Es información pública, no un espejo
    // del estado oculto: aquí solo entra lo que cualquiera sentado a la mesa vería.
    rangosRevelados: {},
    historia: [],
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

      // La TORRE, que no sale por `rayo` porque el castillo corta la línea.
      //
      // Es ADYACENCIA al castillo, no línea de tiro: la baten las doce casillas
      // que lo rodean. Se ve con G6, pegada al castillo por arriba pero cuya
      // recta hacia el sur solo encuentra G7, G8 y G9, que son celdas del
      // anillo, nunca la torre. La bala pasa por encima del anillo, así que da
      // igual quién lo ocupe, y batir al del anillo sigue siendo otra opción.
      //
      // Un cañón metido en el anillo no puede: no está en las doce y tampoco
      // combate cuerpo a cuerpo.
      if (BATEN_LA_TORRE.has(pieza.casilla)) {
        const enTorre = piezaEn(estado, TORRE);
        if (enTorre && !sonAliados(estado, enTorre.color, color)) {
          acciones.push({ tipo: "disparar", pieza: pieza.id, desde: pieza.casilla, hasta: TORRE });
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

// EN UNA CASILLA CABE MÁS DE UNA BANDERA. `banderasSueltas` era un mapa
// casilla -> color y la segunda que caía sobrescribía a la primera: no quedaba
// escondida, DESAPARECÍA del estado y no se podía recoger nunca más. Pasa fácil
// en el anillo, que es una sola casilla lógica donde se concentra el combate del
// final. Ahora cada casilla guarda una lista.
export const banderasEn = (estado, casilla) => estado.banderasSueltas[casilla] || [];

function soltarBandera(estado, pieza) {
  if (!llevaBandera(pieza)) return;
  const color = pieza.bandera;
  pieza.bandera = null;
  const aqui = estado.banderasSueltas[pieza.casilla];
  // La copia importa: `aplicar` clona el mapa por encima, así que empujar sobre
  // la lista del estado anterior le cambiaría las banderas a una partida ya
  // jugada.
  estado.banderasSueltas[pieza.casilla] = aqui ? [...aqui, color] : [color];
  estado.banderas[color].portador = null;
  estado.banderas[color].casilla = pieza.casilla;
}

function recogerBandera(estado, pieza, cual = null) {
  const aqui = banderasEn(estado, pieza.casilla);
  // Sin decir cuál, se coge la primera que cayó: es lo que hacía antes cuando
  // solo cabía una, y deja el orden de llegada como criterio.
  const color = cual && aqui.includes(cual) ? cual : aqui[0];
  if (!color || llevaBandera(pieza)) return null;
  const resto = aqui.filter((c, i) => !(c === color && aqui.indexOf(color) === i));
  if (resto.length) estado.banderasSueltas[pieza.casilla] = resto;
  else delete estado.banderasSueltas[pieza.casilla];
  pieza.bandera = color;
  estado.banderas[color].portador = pieza.id;
  estado.banderas[color].casilla = null;
  return color;
}

function retirar(estado, pieza, { soltar = true } = {}) {
  if (soltar) soltarBandera(estado, pieza);
  delete estado.tablero[pieza.casilla];
  estado.bajas[pieza.color].push(pieza.rango);
  // Registro público de caídas, distinto de `bajas`.
  //
  // `bajas` es la bolsa de reclutamiento y `reclutar` SACA de ella el rango que
  // se recupera, así que leerla sería saber QUÉ pieza ha vuelto — y eso no es
  // público: el evento de reclutamiento publica el color y nada más. Aquí solo
  // se apunta y nunca se quita, que es exactamente lo que ve la mesa: todas las
  // muertes publican el rango, en el duelo o en el cañonazo.
  //
  // Sirve para contar la bolsa oculta del rival de verdad. Sin esto, la sospecha
  // de cañón se calculaba como "quedan 2 de 2 siempre", porque un cañón no se
  // revela nunca: no sobrevive a un duelo y no se delata al moverse. Medido: 0
  // cañones revelados en 7.335 turnos.
  if (estado.caidosPublicos && estado.caidosPublicos[pieza.color]) {
    estado.caidosPublicos[pieza.color].push(pieza.rango);
  }
  delete estado.piezas[pieza.id];
  // Un rango revelado deja de interesar cuando la pieza ya no está en el tablero.
  if (estado.rangosRevelados) delete estado.rangosRevelados[pieza.id];
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
  encolarPendiente(estado, {
    tipo: "reclutar",
    color,
    motivo,
    opciones: [...new Set(estado.bajas[color])].sort((a, b) => b - a),
  });
}

// --- Recogida de bandera ------------------------------------------------------
// Recoger es una opción, no una obligación: quien cae sobre una bandera suelta
// decide. La decisión se ofrece antes que un reclutamiento abierto en la misma
// jugada, porque recoger puede a su vez cambiar lo que se recluta.

function ofrecerRecogida(estado, pieza) {
  const aqui = banderasEn(estado, pieza.casilla);
  if (!aqui.length || llevaBandera(pieza)) return false;
  encolarPendiente(
    estado,
    {
      tipo: "recoger", color: pieza.color, pieza: pieza.id, casilla: pieza.casilla,
      // `bandera` es la que se ofrece; `banderas` son todas las que hay ahí, por
      // si algún día se deja elegir. Se mantienen las dos para no romper a quien
      // solo lee la primera.
      bandera: aqui[0], banderas: [...aqui],
    },
    { alFrente: true }
  );
  return true;
}

// Lo que cuelga de recoger de verdad: la promoción y, si es en la torre, la victoria.
function consumarRecogida(estado, pieza) {
  const recogida = recogerBandera(estado, pieza);
  if (!recogida) return;
  const eraDeSuDueño = estado.banderas[recogida].ultimoDueño === recogida;
  const daPromocion = !sonAliados(estado, recogida, pieza.color) && eraDeSuDueño;
  estado.banderas[recogida].ultimoDueño = pieza.color;
  estado.eventos.push({ tipo: "bandera-recogida", color: pieza.color, bandera: recogida, casilla: pieza.casilla });
  if (daPromocion && !hayReclutamiento(estado)) abrirReclutamiento(estado, pieza.color, "bandera");
  comprobarVictoria(estado, pieza);
}

// ¿La bandera que lleva esta pieza le sirve para coronar?
//
// SOLO LA PROPIA. Una bandera de color X solo la corona una pieza del ejército
// X. Si alguien se instala en la torre con la bandera de otro color, la partida
// sigue: se queda ahí ocupando el sitio, que es un estorbo, no una victoria.
//
// Lo del equipo es aparte y no cambia: cuando el compañero corona SU bandera,
// ganan los dos, y eso lo resuelve `equipoDe` más abajo. Antes esta función
// aceptaba también la del compañero y era demasiado permisiva.
//
// Se usa en un solo sitio a propósito: los bots necesitan saber quién está a un
// movimiento de ganar, y si duplicaran la regla, cambiarla aquí los dejaría
// prediciendo un juego distinto del que se juega.
export function banderaQueCorona(estado, pieza) {
  return Boolean(pieza && pieza.bandera && pieza.bandera === pieza.color);
}

function comprobarVictoria(estado, pieza) {
  if (pieza.casilla !== TORRE || !llevaBandera(pieza)) return;
  if (!banderaQueCorona(estado, pieza)) return;
  estado.fin = {
    ganador: pieza.color,
    equipo: equipoDe(pieza.color),
    bandera: pieza.bandera,
  };
  estado.eventos.push({ tipo: "victoria", color: pieza.color });
}

// Se exporta porque los bots necesitan predecir el resultado de un ataque sin
// reimplementar la regla. Trabaja con rangos sueltos, no con piezas.
export function resolverDuelo(rangoAtacante, rangoDefensor) {
  if (rangoAtacante === ESPIA && rangoDefensor === MARISCAL) return "atacante";
  if (rangoAtacante === rangoDefensor) return "empate";
  return rangoAtacante > rangoDefensor ? "atacante" : "defensor";
}

export function aplicar(estadoPrevio, accion) {
  if (estadoPrevio.fin) throw new Error("La partida ya ha terminado.");
  if (estadoPrevio.pendiente) throw new Error("Hay una decisión pendiente de resolver.");

  const legales = movimientosLegales(estadoPrevio);
  const encaja = legales.find(
    (a) => a.tipo === accion.tipo && a.pieza === accion.pieza && a.hasta === accion.hasta && (a.via || null) === (accion.via || null)
  );
  if (!encaja) throw new Error("Acción ilegal.");

  const estado = clonar(estadoPrevio);
  asegurarRegistros(estado);
  estado.eventos = [];
  const pieza = estado.piezas[accion.pieza];
  const colorQueJuega = pieza.color; // la pieza puede desaparecer antes de anotar la historia

  if (accion.tipo === "mover") {
    revelarPorMovimiento(estado, pieza, encaja);
    registrarTramo(pieza, pieza.casilla, accion.hasta);
    mover(estado, pieza, accion.hasta);
    // Si hay bandera que recoger se pregunta; si no, la jugada ya puede coronar.
    if (!ofrecerRecogida(estado, pieza)) comprobarVictoria(estado, pieza);
  }

  if (accion.tipo === "disparar") {
    const objetivo = piezaEn(estado, accion.hasta);
    estado.eventos.push({
      tipo: "cañonazo",
      color: pieza.color,
      desde: pieza.casilla,
      objetivo: { id: objetivo.id, color: objetivo.color, rango: objetivo.rango, casilla: objetivo.casilla },
    });
    retirar(estado, objetivo);
    retirar(estado, pieza);
    sumarVictoria(estado, accion.color || pieza.color);
  }

  if (accion.tipo === "atacar") {
    const defensor = piezaEn(estado, accion.hasta);
    const resultado = resolverDuelo(pieza.rango, defensor.rango);
    estado.eventos.push({
      tipo: "duelo",
      casilla: defensor.casilla,
      atacante: { id: pieza.id, color: pieza.color, rango: pieza.rango, casilla: pieza.casilla },
      defensor: { id: defensor.id, color: defensor.color, rango: defensor.rango, casilla: defensor.casilla },
      resultado,
    });
    revelarSuperviviente(estado, pieza, defensor, resultado);

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
      if (!ofrecerRecogida(estado, pieza)) {
        // El atacante ya llevaba bandera, así que la del caído se queda en el suelo.
        if (banderaCaida) estado.eventos.push({ tipo: "bandera-en-el-suelo", bandera: banderaCaida, casilla: destino });
        comprobarVictoria(estado, pieza);
      }
    } else {
      const color = defensor.color;
      retirar(estado, pieza);
      sumarVictoria(estado, color);
    }
  }

  if (!estado.fin && !estado.pendiente) pasarTurno(estado);

  anotarEnHistoria(estado, {
    color: colorQueJuega,
    tipo: encaja.tipo,
    desde: encaja.desde,
    hasta: encaja.hasta,
    via: encaja.via || null,
    eventos: [...estado.eventos],
  });
  return estado;
}

export function recogerLaBandera(estado) {
  if (!estado.pendiente || estado.pendiente.tipo !== "recoger") throw new Error("No hay ninguna bandera que recoger.");
  const siguiente = clonar(estado);
  asegurarRegistros(siguiente);
  const { color, pieza: idPieza } = siguiente.pendiente;
  siguiente.eventos = [];
  siguiente.pendiente = null;
  const pieza = siguiente.piezas[idPieza];
  if (pieza) consumarRecogida(siguiente, pieza);
  cerrarPendiente(siguiente);
  anotarEnHistoria(siguiente, { color, tipo: "recoger", eventos: [...siguiente.eventos] });
  return siguiente;
}

export function renunciarARecoger(estado) {
  if (!estado.pendiente || estado.pendiente.tipo !== "recoger") throw new Error("No hay ninguna bandera que recoger.");
  const siguiente = clonar(estado);
  asegurarRegistros(siguiente);
  const { color, bandera, casilla } = siguiente.pendiente;
  siguiente.pendiente = null;
  // La bandera sigue donde estaba: quien la rechaza se queda encima de ella.
  siguiente.eventos = [{ tipo: "bandera-rechazada", color, bandera, casilla }];
  cerrarPendiente(siguiente);
  anotarEnHistoria(siguiente, { color, tipo: "renunciar-recoger", eventos: [...siguiente.eventos] });
  return siguiente;
}

export function reclutar(estado, rango) {
  if (!estado.pendiente || estado.pendiente.tipo !== "reclutar") throw new Error("No hay reclutamiento pendiente.");
  const siguiente = clonar(estado);
  asegurarRegistros(siguiente);
  const { color } = siguiente.pendiente;
  const indice = siguiente.bajas[color].indexOf(rango);
  if (indice === -1) throw new Error("Esa pieza no está entre tus bajas.");
  const casilla = ZONAS[color].reclutamiento;
  siguiente.bajas[color].splice(indice, 1);
  const id = `${color}-r${++siguiente.contador}`;
  siguiente.piezas[id] = { id, color, rango, casilla, bandera: null, alternancias: 0, ultimoTramo: null };
  siguiente.tablero[casilla] = id;
  siguiente.pendiente = null;
  // El rango no se publica, pero el hecho sí: cualquiera puede contar cuántas
  // veces ha reclutado cada bando, y eso limita cuántos de los caídos pueden
  // haber vuelto.
  siguiente.reclutas[color] = (siguiente.reclutas[color] || 0) + 1;
  siguiente.eventos = [{ tipo: "reclutamiento", color }]; // el rango no se publica
  cerrarPendiente(siguiente);
  // El rango SÍ se guarda en el hilo, pero tapado hasta el final: sin él, una
  // partida terminada no se puede reproducir. El replay pierde al recluta y todo
  // lo que haga después, y sin replay no hay forma de analizar qué jugadas
  // decidieron la partida. `historiaPublica` lo quita mientras se juega.
  anotarEnHistoria(siguiente, { color, tipo: "reclutar", rango, eventos: [...siguiente.eventos] });
  return siguiente;
}

export function renunciarAlReclutamiento(estado) {
  const siguiente = clonar(estado);
  asegurarRegistros(siguiente);
  const color = estado.pendiente.color;
  siguiente.pendiente = null;
  siguiente.eventos = [{ tipo: "reclutamiento-renunciado", color }];
  cerrarPendiente(siguiente);
  anotarEnHistoria(siguiente, { color, tipo: "renunciar", eventos: [...siguiente.eventos] });
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

// El hilo tal y como puede verse mientras la partida sigue.
//
// Lo único que hay que tapar es el rango de un reclutamiento: el evento publica
// el color y nada más, y saber QUÉ pieza ha vuelto es información oculta. Se
// guarda en el hilo igualmente porque sin él una partida terminada no se puede
// reproducir, y al terminar se destapa como todo lo demás.
export function historiaPublica(historia) {
  return (historia || []).map((h) => {
    if (h.rango === undefined) return h;
    const { rango, ...resto } = h;
    return resto;
  });
}

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
    // Las listas también se copian: sin esto, soltar una bandera le añadiría una
    // al estado anterior, que se supone inmutable.
    banderasSueltas: Object.fromEntries(
      Object.entries(estado.banderasSueltas).map(([c, cs]) => [c, [...cs]])
    ),
    // Público para todos: son rangos que ya se han visto sobre la mesa.
    rangosRevelados: { ...(estado.rangosRevelados || {}) },
    historia: estado.fin ? [...(estado.historia || [])] : historiaPublica(estado.historia),
    marcador: { ...estado.marcador },
    misBajas: [...estado.bajas[color]],
    pendiente: estado.pendiente && estado.pendiente.color === color ? estado.pendiente : null,
  };
}
