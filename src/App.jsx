import React, { useState, useEffect, useRef, useCallback } from "react";
import { abrirInforme, analizarEnElNavegador } from "./informe-partida.js";
import Tablero3D, { ESTILO, NOMBRE_RANGO, LATON_CSS } from "./Tablero3D.jsx";
import { COLORES, ZONAS, casillasDeZona, zonaDe, coord } from "./motor/tablero.js";
import { RANGOS, VICTORIAS_PARA_RECLUTAR, SOCIO, movimientosLegales, inventarioInicial } from "./motor/motor.js";
import { pintarFicha, LADO_FICHA } from "./ficha.js";

const MADERA = "#3A2A1C";
const MADERA_CLARA = "#5B4229";
const LATON_CLARO = "#E2BB6B";
const PERGAMINO = "#E8DCC2";
const FIELTRO = "#22392E";
const TINTA = "#1C140D";

const EQUIPOS = [["rojo", "azul"], ["verde", "amarillo"]];

function barajar(lista) {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

function colocacionAleatoria(color) {
  const zona = casillasDeZona(color).filter((c) => c !== ZONAS[color].reclutamiento);
  const casillaBandera = ZONAS[color].bandera;
  const resto = barajar(zona.filter((c) => c !== casillaBandera));
  const usadas = [casillaBandera, ...resto.slice(0, 19)];
  const bolsa = barajar(inventarioInicial());
  const mapa = {};
  usadas.forEach((casilla, i) => {
    mapa[casilla] = bolsa[i];
  });
  return mapa;
}

// El servidor manda el estado ya filtrado. Para calcular tus jugadas legales
// solo hacen falta tus rangos y quién ocupa cada casilla.
function estadoJugable(estadoServidor) {
  if (!estadoServidor) return null;
  const tablero = {};
  for (const pieza of Object.values(estadoServidor.piezas)) tablero[pieza.casilla] = pieza.id;
  return {
    ...estadoServidor,
    modo: "equipos",
    orden: COLORES,
    tablero,
    bajas: {},
  };
}

function describirEvento(ev) {
  if (!ev) return null;
  if (ev.tipo === "duelo") {
    const a = `${NOMBRE_RANGO[ev.atacante.rango]} ${ev.atacante.rango} de ${ev.atacante.color}`;
    const d = `${NOMBRE_RANGO[ev.defensor.rango]} ${ev.defensor.rango} de ${ev.defensor.color}`;
    if (ev.resultado === "empate") return `Duelo: ${a} y ${d} caen los dos.`;
    return ev.resultado === "atacante" ? `Duelo: ${a} vence a ${d}.` : `Duelo: ${d} resiste a ${a}.`;
  }
  if (ev.tipo === "cañonazo") {
    return `Cañonazo de ${ev.color}: revienta al ${NOMBRE_RANGO[ev.objetivo.rango]} ${ev.objetivo.rango} de ${ev.objetivo.color} en ${ev.objetivo.casilla}. El cañón se retira.`;
  }
  if (ev.tipo === "bandera-capturada") return `${ev.color} se hace con la bandera de ${ev.bandera}.`;
  if (ev.tipo === "bandera-recogida") return `${ev.color} recoge del suelo la bandera de ${ev.bandera}.`;
  if (ev.tipo === "bandera-en-el-suelo") return `La bandera de ${ev.bandera} queda suelta en ${ev.casilla}.`;
  if (ev.tipo === "bandera-rechazada") return `${ev.color} deja en el suelo la bandera de ${ev.bandera}, en ${ev.casilla}.`;
  if (ev.tipo === "reclutamiento") return `${ev.color} recupera una pieza en su casilla de reclutamiento.`;
  if (ev.tipo === "reclutamiento-fallido") return `${ev.color} pierde su reclutamiento: ${ev.razón}.`;
  if (ev.tipo === "victoria") return `¡${ev.color} corona su bandera en la torre!`;
  if (ev.tipo === "turno-saltado") return `${ev.color} no tiene movimientos y pasa turno.`;
  return null;
}

// Exporta el despliegue como rejilla de texto, en coordenadas de la propia
// zona. Es el formato que come el banco de pruebas, y sirve igual para los
// cuatro colores aunque las zonas norte y sur sean anchas y las otras altas.
//
// Existe porque leer los rangos de una captura del tablero 3D es poco fiable:
// una silueta mal interpretada entraría en la batería como una apertura que no
// es, sin dar error. Con esto se copia y se pega, y no hay nada que interpretar.
function despliegueComoRejilla(color, colocacion) {
  const zona = ZONAS[color];
  const [cBandera, fBandera] = coord(zona.bandera);
  const anchaEnColumnas = zona.cols[1] - zona.cols[0] > zona.filas[1] - zona.filas[0];
  const rejilla = Array.from({ length: 3 }, () => Array(7).fill("?"));

  for (const casilla of casillasDeZona(color)) {
    const [c, f] = coord(casilla);
    const profundidad = anchaEnColumnas
      ? (fBandera === zona.filas[0] ? f - zona.filas[0] : zona.filas[1] - f)
      : (cBandera === zona.cols[0] ? c - zona.cols[0] : zona.cols[1] - c);
    const lateral = anchaEnColumnas ? c - zona.cols[0] : f - zona.filas[0];
    if (casilla === zona.reclutamiento) rejilla[profundidad][lateral] = ".";
    else if (colocacion[casilla]) rejilla[profundidad][lateral] = String(colocacion[casilla]);
  }
  const cabecera = [
    `# despliegue de ${color}`,
    "# fila 1 la más atrasada · fila 3 la más adelantada",
    "# el punto es la casilla de reclutamiento · la bandera va en el centro de la fila 1",
  ];
  return `${cabecera.join("\n")}\n${rejilla.map((f) => f.join(" ")).join("\n")}`;
}

function Boton({ children, onClick, disabled, variante = "principal" }) {
  const base = {
    fontFamily: "Georgia, serif",
    fontSize: 14,
    padding: "8px 16px",
    borderRadius: 3,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
  };
  const estilos = {
    principal: { background: LATON_CSS, color: TINTA, border: `1px solid ${LATON_CLARO}` },
    secundario: { background: "transparent", color: PERGAMINO, border: `1px solid ${LATON_CSS}` },
    peligro: { background: "transparent", color: "#E8A9A4", border: "1px solid #8C4038" },
  };
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{ ...base, ...estilos[variante] }}>
      {children}
    </button>
  );
}

const entradaEstilo = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(0,0,0,0.28)",
  border: `1px solid ${LATON_CSS}`,
  borderRadius: 3,
  color: PERGAMINO,
  padding: "9px 11px",
  fontSize: 15,
  fontFamily: "Georgia, serif",
  outline: "none",
};

const panelEstilo = {
  background: MADERA,
  border: `2px solid ${LATON_CSS}`,
  borderRadius: 6,
  padding: 18,
  color: PERGAMINO,
  fontFamily: "Georgia, serif",
};

function Rotulo({ children }) {
  return (
    <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: LATON_CLARO, marginBottom: 8 }}>
      {children}
    </div>
  );
}

function Sello({ color, tamano = 30, activo }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: tamano,
        height: tamano,
        borderRadius: "50%",
        background: ESTILO[color].css,
        border: activo ? `3px solid ${LATON_CLARO}` : `2px solid ${LATON_CSS}`,
      }}
    />
  );
}

// Una entrada del hilo son los eventos que provocó la jugada, más una línea para
// la propia jugada cuando no generó ninguno (un movimiento sin combate).
function describirJugada(entrada) {
  const textos = (entrada.eventos || []).map(describirEvento).filter(Boolean);
  if (entrada.tipo === "mover") {
    const via = entrada.via ? ` pasando por ${entrada.via}` : "";
    textos.unshift(`${entrada.color} mueve de ${entrada.desde} a ${entrada.hasta}${via}.`);
  } else if (entrada.tipo === "renunciar") {
    textos.unshift(`${entrada.color} renuncia a reclutar.`);
  } else if (entrada.tipo === "recoger" && !textos.length) {
    textos.unshift(`${entrada.color} recoge la bandera.`);
  } else if (entrada.tipo === "renunciar-recoger" && !textos.length) {
    textos.unshift(`${entrada.color} no recoge la bandera.`);
  } else if (!textos.length && entrada.hasta) {
    textos.unshift(`${entrada.color} juega sobre ${entrada.hasta}.`);
  }
  return textos;
}

// Hilo de la partida: se puede subir a repasar lo que pasó en turnos anteriores.
// Se mantiene pegado abajo salvo que el jugador haya subido a leer.
function Historia({ historia }) {
  const caja = useRef(null);
  const pegadoAbajo = useRef(true);

  useEffect(() => {
    const nodo = caja.current;
    if (nodo && pegadoAbajo.current) nodo.scrollTop = nodo.scrollHeight;
  }, [historia]);

  if (!historia || !historia.length) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <Rotulo>Hilo de la partida</Rotulo>
      <div
        ref={caja}
        onScroll={(e) => {
          const n = e.currentTarget;
          pegadoAbajo.current = n.scrollHeight - n.scrollTop - n.clientHeight < 24;
        }}
        style={{
          maxHeight: 200,
          overflowY: "auto",
          background: "rgba(0,0,0,0.28)",
          borderRadius: 3,
          padding: "8px 10px",
          fontSize: 12.5,
          lineHeight: 1.5,
        }}
      >
        {historia.map((entrada) => (
          <div key={entrada.n} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <span style={{ color: LATON_CLARO, flex: "0 0 auto", minWidth: 26, textAlign: "right" }}>{entrada.n}</span>
            <span
              style={{
                flex: "0 0 auto",
                width: 8,
                height: 8,
                marginTop: 5,
                borderRadius: "50%",
                background: ESTILO[entrada.color] ? ESTILO[entrada.color].css : "transparent",
              }}
            />
            <span style={{ color: "#D9CFB6" }}>
              {describirJugada(entrada).map((t, i) => (
                <div key={i}>{t}</div>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Cuántas victorias lleva cada bando y cuánto le falta para poder reclutar.
function Marcador({ marcador, miColor }) {
  if (!marcador) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <Rotulo>Victorias para reclutar</Rotulo>
      {COLORES.map((c) => {
        const victorias = marcador[c] || 0;
        const mio = miColor && (c === miColor || c === SOCIO[miColor]);
        return (
          <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <Sello color={c} tamano={12} />
            <div style={{ flex: 1, height: 8, background: "rgba(0,0,0,0.35)", borderRadius: 4, overflow: "hidden" }}>
              <div
                style={{
                  width: `${(victorias / VICTORIAS_PARA_RECLUTAR) * 100}%`,
                  height: "100%",
                  background: ESTILO[c].css,
                }}
              />
            </div>
            <span
              style={{
                fontSize: 12,
                minWidth: 58,
                textAlign: "right",
                color: mio ? PERGAMINO : "#9C917A",
                fontWeight: mio ? 700 : 400,
              }}
            >
              {victorias} de {VICTORIAS_PARA_RECLUTAR}
            </span>
          </div>
        );
      })}
      <div style={{ fontSize: 11.5, color: "#9C917A", marginTop: 2 }}>
        Al llegar a {VICTORIAS_PARA_RECLUTAR} se recupera una pieza y el contador vuelve a cero.
      </div>
    </div>
  );
}

// Ficha plana, para la ventana de combate. Es el mismo dibujo que llevan las
// piezas del tablero 3D, pintado en un canvas normal.
function FichaPintada({ rango, color, tamano = 84 }) {
  const lienzo = useRef(null);
  useEffect(() => {
    const nodo = lienzo.current;
    if (!nodo) return;
    pintarFicha(nodo.getContext("2d"), rango, ESTILO[color] ? ESTILO[color].css : null);
  }, [rango, color]);
  return (
    <canvas
      ref={lienzo}
      width={LADO_FICHA}
      height={LADO_FICHA}
      style={{ width: tamano, height: tamano, display: "block" }}
    />
  );
}

// Un combate es lo único que destapa rangos ajenos, y solo mientras se mira. De
// una entrada del hilo salen los duelos y los cañonazos que haya provocado.
const RANGO_CANON = 1;

function combatesDeEntrada(entrada) {
  const lista = [];
  for (const ev of entrada.eventos || []) {
    if (ev.tipo === "duelo") {
      lista.push({
        clase: "duelo",
        casilla: ev.casilla,
        atacante: ev.atacante,
        defensor: ev.defensor,
        resultado: ev.resultado,
      });
    }
    if (ev.tipo === "cañonazo") {
      lista.push({
        clase: "cañonazo",
        casilla: ev.objetivo.casilla,
        atacante: { color: ev.color, rango: RANGO_CANON },
        defensor: ev.objetivo,
        resultado: "cañonazo",
      });
    }
  }
  return lista;
}

function desenlaceDeCombate(combate) {
  const a = `${NOMBRE_RANGO[combate.atacante.rango]} de ${combate.atacante.color}`;
  const d = `${NOMBRE_RANGO[combate.defensor.rango]} de ${combate.defensor.color}`;
  if (combate.clase === "cañonazo") return `El cañonazo revienta al ${d}. El cañón se retira tras disparar.`;
  if (combate.resultado === "empate") return `Mismo grado: caen los dos y la casilla queda vacía.`;
  if (combate.resultado === "atacante") return `Vence el ${a} y ocupa la casilla.`;
  return `Resiste el ${d}. El ${a} se retira del tablero.`;
}

// Ventana de combate: sale sola cuando hay un choque y se queda hasta que se
// cierra. Es el único momento en que se ven los rangos de las piezas ajenas;
// después vuelven a estar tapadas y lo que quede es la memoria de cada uno.
function VentanaCombate({ combate, quedan, onCerrar }) {
  const perdedor = (lado) => {
    if (combate.clase === "cañonazo") return true;
    if (combate.resultado === "empate") return true;
    return combate.resultado === "atacante" ? lado === "defensor" : lado === "atacante";
  };
  const caja = (lado, pieza, rotulo) => (
    <div style={{ textAlign: "center", opacity: perdedor(lado) ? 0.45 : 1 }}>
      <FichaPintada rango={pieza.rango} color={pieza.color} />
      <div style={{ marginTop: 6, fontSize: 12, letterSpacing: ".06em", color: LATON_CLARO, textTransform: "uppercase" }}>
        {rotulo}
      </div>
      <div style={{ fontSize: 14, color: PERGAMINO }}>
        {pieza.rango} {NOMBRE_RANGO[pieza.rango]}
      </div>
      <div style={{ fontSize: 12.5, color: "#C9BC9C" }}>{pieza.color}</div>
      {perdedor(lado) && <div style={{ fontSize: 12, color: "#C98A7A", marginTop: 2 }}>cae</div>}
    </div>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 8, 5, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
    >
      <div style={{ ...panelEstilo, maxWidth: 420, width: "100%", textAlign: "center" }}>
        <Rotulo>{combate.clase === "cañonazo" ? "Cañonazo" : "Combate"} en {combate.casilla}</Rotulo>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, margin: "14px 0" }}>
          {caja("atacante", combate.atacante, combate.clase === "cañonazo" ? "Dispara" : "Ataca")}
          <div style={{ fontSize: 17, color: LATON_CLARO, fontStyle: "italic" }}>contra</div>
          {caja("defensor", combate.defensor, "Defiende")}
        </div>
        <p style={{ fontSize: 14, color: PERGAMINO, margin: "0 0 14px" }}>{desenlaceDeCombate(combate)}</p>
        <Boton onClick={onCerrar}>{quedan > 1 ? `Siguiente (quedan ${quedan - 1})` : "Cerrar"}</Boton>
      </div>
    </div>
  );
}

// La escala de dificultad. Se repite aquí en vez de importarla de
// `src/motor/dificultad.js` porque ese módulo lo carga el servidor y no conviene
// arrastrar sus dependencias al paquete del navegador; los nombres son texto de
// presentación y el servidor valida el número igualmente.
const ESCALA_DIFICULTAD = [
  { nivel: 1, nombre: "Recluta", descripcion: "No recuerda lo que ha visto en combate y se despista mucho." },
  { nivel: 2, nombre: "Veterano", descripcion: "Recuerda los rangos revelados, pero juega de heurística y falla a menudo." },
  { nivel: 3, nombre: "Oficial", descripcion: "Usa la red entrenada y despliega con ella, aunque se equivoca la mitad de las veces." },
  { nivel: 4, nombre: "Coronel", descripcion: "La red entrenada con pocos despistes." },
  { nivel: 5, nombre: "Mariscal", descripcion: "Todo lo que sabe, sin un solo fallo deliberado." },
];

// Selector de dificultad de un bot. Se puede cambiar también en mitad de la
// partida: sirve para bajarle los humos a uno que está arrasando.
function SelectorDeNivel({ nivel, onCambio }) {
  const actual = ESCALA_DIFICULTAD.find((n) => n.nivel === nivel) || ESCALA_DIFICULTAD[3];
  return (
    <label
      title={`${actual.nombre}: ${actual.descripcion}`}
      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: LATON_CLARO }}
    >
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={nivel}
        onChange={(e) => onCambio(Number(e.target.value))}
        style={{ width: 76, accentColor: LATON_CLARO }}
        aria-label="Dificultad del bot"
      />
      <span style={{ minWidth: 62, fontVariantNumeric: "tabular-nums" }}>{nivel} · {actual.nombre}</span>
    </label>
  );
}

export default function App() {
  const [yo, setYo] = useState(null);
  const [nombreBorrador, setNombreBorrador] = useState("");
  const [salas, setSalas] = useState({});
  const [salaId, setSalaId] = useState(null);
  const [conectado, setConectado] = useState(false);
  const [aviso, setAviso] = useState("");
  const [analizando, setAnalizando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [nuevaSala, setNuevaSala] = useState({ nombre: "", privada: false, clave: "" });
  const [pidiendoClave, setPidiendoClave] = useState(null);
  const [claveEntrada, setClaveEntrada] = useState("");
  const [colocacion, setColocacion] = useState({});
  const [rangoActivo, setRangoActivo] = useState(9);
  const [seleccion, setSeleccion] = useState(null);
  const [combates, setCombates] = useState([]);
  const combatesVistos = useRef({});
  const [tableroAmpliado, setTableroAmpliado] = useState(false);
  const [rejillaCopiada, setRejillaCopiada] = useState(null);
  const [confirmando, setConfirmando] = useState(null); // "parar" | "borrar", solo el anfitrión
  const socketRef = useRef(null);
  const yoRef = useRef(null);

  useEffect(() => {
    yoRef.current = yo;
  }, [yo]);

  // Al cambiar de sala no se arrastra una confirmación a medias de la anterior.
  useEffect(() => {
    setConfirmando(null);
  }, [salaId]);

  useEffect(() => {
    let guardado = null;
    try {
      guardado = JSON.parse(localStorage.getItem("s4:jugador") || "null");
    } catch (e) {
      guardado = null;
    }
    if (guardado && guardado.id) setYo(guardado);

    let cerrado = false;
    let reintento = null;

    function conectar() {
      const protocolo = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocolo}://${location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => {
        setConectado(true);
        const identidad = yoRef.current;
        if (identidad) socket.send(JSON.stringify({ tipo: "hola", id: identidad.id, nombre: identidad.nombre }));
      };
      socket.onmessage = (e) => {
        const mensaje = JSON.parse(e.data);
        if (mensaje.tipo === "salas") setSalas(mensaje.salas);
        if (mensaje.tipo === "identidad") {
          const identidad = { id: mensaje.id, nombre: mensaje.nombre };
          localStorage.setItem("s4:jugador", JSON.stringify(identidad));
          setYo(identidad);
        }
        if (mensaje.tipo === "error") setAviso(mensaje.texto);
      };
      socket.onclose = () => {
        setConectado(false);
        if (!cerrado) reintento = setTimeout(conectar, 1500);
      };
    }
    conectar();

    return () => {
      cerrado = true;
      if (reintento) clearTimeout(reintento);
      if (socketRef.current) socketRef.current.close();
    };
  }, []);

  const enviar = useCallback((mensaje) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setAviso("Sin conexión con el servidor.");
      return;
    }
    socket.send(JSON.stringify(mensaje));
  }, []);

  function presentarse() {
    const nombre = nombreBorrador.trim();
    if (nombre.length < 2) {
      setAviso("Escribe un nombre de al menos dos letras.");
      return;
    }
    const identidad = yo || { id: "j_" + Math.random().toString(36).slice(2, 9) };
    enviar({ tipo: "hola", id: identidad.id, nombre });
    setAviso("");
  }

  const sala = salaId ? salas[salaId] : null;
  const miColor = sala ? sala.miColor : null;
  const soyAnfitrion = sala && yo && sala.anfitrion === yo.id;
  const estado = sala && sala.estado ? estadoJugable(sala.estado) : null;
  const esMiTurno = Boolean(estado && miColor && estado.turno === miColor && !estado.fin);
  const accionesMias = esMiTurno && !estado.pendiente ? movimientosLegales(estado, miColor) : [];

  useEffect(() => {
    if (sala && sala.fase === "desplegando" && sala.desplegados.includes(miColor)) setColocacion({});
  }, [sala && sala.fase, sala && sala.desplegados.length]);

  // Cola de combates por enseñar. Al entrar en una sala se marca como visto todo
  // lo ya jugado: al reconectar no tiene sentido soltar de golpe los combates de
  // hace veinte turnos.
  useEffect(() => {
    if (!sala || !sala.estado || !sala.estado.historia) return;
    const historia = sala.estado.historia;
    const ultima = historia.length ? historia[historia.length - 1].n : 0;
    const visto = combatesVistos.current[sala.id];
    if (visto === undefined) {
      combatesVistos.current[sala.id] = ultima;
      return;
    }
    if (ultima <= visto) return;
    combatesVistos.current[sala.id] = ultima;
    const nuevos = [];
    for (const entrada of historia) {
      if (entrada.n <= visto) continue;
      for (const combate of combatesDeEntrada(entrada)) nuevos.push({ ...combate, n: entrada.n });
    }
    if (nuevos.length) setCombates((previos) => [...previos, ...nuevos]);
  }, [sala && sala.id, sala && sala.estado && sala.estado.historia]);

  // Al cambiar de sala no se arrastran los combates de la anterior.
  useEffect(() => {
    setCombates([]);
  }, [salaId]);

  // M amplía y reduce la escena; Escape siempre la reduce.
  useEffect(() => {
    const alTeclear = (e) => {
      const etiqueta = e.target && e.target.tagName;
      if (etiqueta === "INPUT" || etiqueta === "TEXTAREA") return;
      if (e.key === "m" || e.key === "M") setTableroAmpliado((v) => !v);
      else if (e.key === "Escape") setTableroAmpliado(false);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, []);

  // Con la escena ampliada el panel lateral queda debajo, así que una decisión
  // pendiente sería imposible de contestar: se reduce sola para que se vea.
  const hayDecision = Boolean(sala && sala.estado && sala.estado.pendiente);
  useEffect(() => {
    if (hayDecision) setTableroAmpliado(false);
  }, [hayDecision]);

  const restantes = miColor
    ? Object.entries(RANGOS)
        .map(([rango, info]) => {
          const puestas = Object.values(colocacion).filter((r) => r === Number(rango)).length;
          return { rango: Number(rango), nombre: info.nombre, quedan: info.cantidad - puestas };
        })
        .sort((a, b) => b.rango - a.rango)
    : [];

  const alClicarDespliegue = useCallback(
    (casilla) => {
      if (!miColor) return;
      if (zonaDe(casilla) !== miColor) {
        setAviso(`${casilla} está fuera de tu zona.`);
        return;
      }
      if (casilla === ZONAS[miColor].reclutamiento) {
        setAviso(`${ZONAS[miColor].reclutamiento} es tu casilla de reclutamiento y va vacía.`);
        return;
      }
      setAviso("");
      setColocacion((previa) => {
        if (previa[casilla]) {
          const copia = { ...previa };
          delete copia[casilla];
          return copia;
        }
        const puestas = Object.values(previa).filter((r) => r === rangoActivo).length;
        if (puestas >= RANGOS[rangoActivo].cantidad) {
          setAviso("Ya has colocado todas las piezas de ese rango.");
          return previa;
        }
        return { ...previa, [casilla]: rangoActivo };
      });
    },
    [miColor, rangoActivo]
  );

  const alClicarPartida = useCallback(
    (casilla) => {
      if (!estado || !miColor) return;
      if (!esMiTurno) {
        setAviso("No es tu turno.");
        return;
      }
      const propia = Object.values(estado.piezas).find((p) => p.casilla === casilla && p.color === miColor);
      if (propia) {
        setSeleccion({ id: propia.id, casilla });
        setAviso("");
        return;
      }
      if (!seleccion) return;
      const accion = accionesMias.find((a) => a.pieza === seleccion.id && a.hasta === casilla);
      if (!accion) {
        setAviso("Esa jugada no es legal con la pieza elegida.");
        return;
      }
      setSeleccion(null);
      setAviso("");
      enviar({ tipo: "accion", sala: salaId, accion });
    },
    [estado, miColor, esMiTurno, seleccion, accionesMias, enviar, salaId]
  );

  // Dónde ha caído un cañonazo, y si todavía arde. El hilo guarda el evento con
  // su casilla, así que basta con mirarlo.
  //
  // El fuego dura hasta que le vuelve el turno a quien disparó —cuatro jugadas en
  // una partida a cuatro—, que es el tiempo justo para que el resto se entere de
  // que ahí ha pasado algo. Después queda el carbón, y ese no se va: una casilla
  // donde reventó un cañón sigue contando algo de la partida mucho después.
  const explosionesRecientes = (() => {
    const historia = (estado && estado.historia) || [];
    if (!historia.length) return [];
    const ultima = historia[historia.length - 1].n;
    const salida = [];
    for (const entrada of historia) {
      for (const evento of entrada.eventos || []) {
        if (evento.tipo !== "cañonazo" || !evento.objetivo || !evento.objetivo.casilla) continue;
        salida.push({ casilla: evento.objetivo.casilla, ardiendo: ultima - entrada.n < 4 });
      }
    }
    return salida;
  })();

  const resaltadas = (() => {
    if (!seleccion) return {};
    const marcas = { [seleccion.casilla]: "seleccion" };
    for (const a of accionesMias) if (a.pieza === seleccion.id) marcas[a.hasta] = a.tipo === "mover" ? "mover" : a.tipo;
    return marcas;
  })();

  const marco = { minHeight: "100vh", background: FIELTRO, padding: 16, fontFamily: "Georgia, serif", color: PERGAMINO };

  if (!yo || !yo.nombre) {
    return (
      <div style={marco}>
        <div style={{ ...panelEstilo, maxWidth: 420, margin: "40px auto" }}>
          <h1 style={{ fontSize: 30, letterSpacing: "0.2em", textAlign: "center", textTransform: "uppercase", margin: "0 0 6px" }}>
            Reuter<span style={{ color: LATON_CLARO }}>4</span>
          </h1>
          <p style={{ textAlign: "center", color: LATON_CLARO, fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase" }}>
            dos bandos, cuatro ejércitos, un castillo
          </p>
          <Rotulo>Tu nombre</Rotulo>
          <input
            style={entradaEstilo}
            value={nombreBorrador}
            maxLength={18}
            onChange={(e) => setNombreBorrador(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && presentarse()}
            placeholder="Napoleón"
          />
          {aviso && <p style={{ color: "#E8A9A4", fontSize: 13 }}>{aviso}</p>}
          <div style={{ marginTop: 12 }}>
            <Boton onClick={presentarse} disabled={!conectado}>
              {conectado ? "Entrar en el campamento" : "Conectando…"}
            </Boton>
          </div>
        </div>
      </div>
    );
  }

  if (!sala) {
    const listado = Object.values(salas).sort((a, b) => b.creada - a.creada);
    return (
      <div style={marco}>
        <div style={{ ...panelEstilo, maxWidth: 760, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h1 style={{ fontSize: 26, letterSpacing: "0.18em", textTransform: "uppercase", margin: 0 }}>
              Reuter<span style={{ color: LATON_CLARO }}>4</span>
            </h1>
            <span style={{ fontSize: 12, color: conectado ? LATON_CLARO : "#E8A9A4" }}>
              {conectado ? `al mando: ${yo.nombre}` : "sin conexión"}
            </span>
          </div>

          {creando ? (
            <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${LATON_CSS}`, borderRadius: 4, padding: 16, marginTop: 14 }}>
              <Rotulo>Nombre de la partida</Rotulo>
              <input
                style={entradaEstilo}
                value={nuevaSala.nombre}
                maxLength={40}
                onChange={(e) => setNuevaSala({ ...nuevaSala, nombre: e.target.value })}
                placeholder={`Campaña de ${yo.nombre}`}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0", fontSize: 15 }}>
                <input
                  type="checkbox"
                  checked={nuevaSala.privada}
                  onChange={(e) => setNuevaSala({ ...nuevaSala, privada: e.target.checked })}
                />
                Partida privada, solo con contraseña
              </label>
              {nuevaSala.privada && (
                <input
                  style={entradaEstilo}
                  value={nuevaSala.clave}
                  maxLength={24}
                  placeholder="contraseña"
                  onChange={(e) => setNuevaSala({ ...nuevaSala, clave: e.target.value })}
                />
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <Boton
                  onClick={() => {
                    enviar({
                      tipo: "crear",
                      nombre: nuevaSala.nombre,
                      clave: nuevaSala.privada ? nuevaSala.clave : null,
                    });
                    setCreando(false);
                    setNuevaSala({ nombre: "", privada: false, clave: "" });
                  }}
                >
                  Levantar la partida
                </Boton>
                <Boton variante="secundario" onClick={() => setCreando(false)}>Cancelar</Boton>
              </div>
            </div>
          ) : (
            <div style={{ margin: "16px 0" }}>
              <Boton onClick={() => setCreando(true)} disabled={!conectado}>Levantar una partida</Boton>
            </div>
          )}

          <Rotulo>Partidas abiertas</Rotulo>
          {listado.length === 0 && (
            <p style={{ fontSize: 15, color: "rgba(232,220,194,0.7)" }}>
              No hay ninguna partida en pie. Levanta la primera y cubre los huecos con bots.
            </p>
          )}
          {listado.map((s) => {
            const ocupados = COLORES.filter((c) => s.puestos[c]).length;
            return (
              <div
                key={s.id}
                style={{
                  border: `1px solid ${LATON_CSS}`,
                  borderRadius: 4,
                  padding: 12,
                  marginBottom: 10,
                  background: "rgba(0,0,0,0.2)",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: "1 1 220px" }}>
                  <div style={{ fontSize: 16 }}>
                    {s.nombre}
                    {s.privada && <span style={{ color: LATON_CLARO, fontSize: 12 }}> · con contraseña</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(232,220,194,0.65)" }}>
                    {ocupados} de 4 puestos ·{" "}
                    {s.fase === "esperando" ? "esperando" : s.fase === "desplegando" ? "desplegando" : "en juego"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  {COLORES.map((c) => (
                    <span
                      key={c}
                      title={s.puestos[c] ? s.puestos[c].nombre : "libre"}
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        background: s.puestos[c] ? ESTILO[c].css : "transparent",
                        border: `1px solid ${s.puestos[c] ? ESTILO[c].css : "rgba(232,220,194,0.35)"}`,
                      }}
                    />
                  ))}
                </div>
                {s.miColor ? (
                  <Boton onClick={() => setSalaId(s.id)}>Volver</Boton>
                ) : s.fase !== "esperando" ? (
                  <span style={{ fontSize: 13, color: "rgba(232,220,194,0.5)" }}>Ya ha empezado</span>
                ) : ocupados === 4 ? (
                  <span style={{ fontSize: 13, color: "rgba(232,220,194,0.5)" }}>Completa</span>
                ) : pidiendoClave === s.id ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      style={{ ...entradaEstilo, width: 130 }}
                      value={claveEntrada}
                      placeholder="contraseña"
                      onChange={(e) => setClaveEntrada(e.target.value)}
                    />
                    <Boton
                      onClick={() => {
                        enviar({ tipo: "unirse", sala: s.id, clave: claveEntrada });
                        setSalaId(s.id);
                        setPidiendoClave(null);
                      }}
                    >
                      Entrar
                    </Boton>
                  </div>
                ) : (
                  <Boton
                    onClick={() => {
                      if (s.privada) {
                        setPidiendoClave(s.id);
                        setClaveEntrada("");
                      } else {
                        enviar({ tipo: "unirse", sala: s.id });
                        setSalaId(s.id);
                      }
                    }}
                  >
                    Unirse
                  </Boton>
                )}
              </div>
            );
          })}
          {aviso && <p style={{ color: "#E8A9A4", fontSize: 13 }}>{aviso}</p>}
        </div>
      </div>
    );
  }

  const piezasEnTablero = (() => {
    if (sala.fase === "esperando") return [];
    if (sala.fase === "desplegando") {
      if (!miColor) return [];
      return Object.entries(colocacion).map(([casilla, rango]) => ({
        casilla,
        color: miColor,
        rango,
        bandera: casilla === ZONAS[miColor].bandera ? miColor : null,
      }));
    }
    return estado ? Object.values(estado.piezas) : [];
  })();

  const yaDesplegado = sala.desplegados && sala.desplegados.includes(miColor);

  return (
    <div style={marco}>
      {combates.length > 0 && (
        <VentanaCombate
          combate={combates[0]}
          quedan={combates.length}
          onCerrar={() => setCombates((previos) => previos.slice(1))}
        />
      )}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap", maxWidth: 1120, margin: "0 auto" }}>
        <div
          style={
            tableroAmpliado
              ? { position: "fixed", inset: 0, zIndex: 30, background: MADERA, padding: 10, display: "flex", flexDirection: "column" }
              : { flex: "1 1 480px", minWidth: 320 }
          }
        >
          <Tablero3D
            piezas={piezasEnTablero}
            banderasSueltas={estado ? estado.banderasSueltas : null}
            resaltadas={sala.fase === "jugando" || sala.fase === "fin" ? resaltadas : {}}
            zonaPropia={sala.fase === "desplegando" ? miColor : null}
            colorCamara={miColor}
            marcador={estado ? estado.marcador : null}
            explosiones={explosionesRecientes}
            onCasilla={sala.fase === "desplegando" ? alClicarDespliegue : alClicarPartida}
            ampliado={tableroAmpliado}
            onAlternarAmpliado={() => setTableroAmpliado((v) => !v)}
          />
          <p style={{ color: "#C9BC9C", fontSize: 12, marginTop: 8, flex: "0 0 auto" }}>
            Arrastra para girar, Mayúsculas o botón derecho para desplazar, rueda para acercar. Tecla M
            para ampliar la escena.{" "}
            {sala.fase === "desplegando"
              ? "Toca una casilla de tu zona para poner o quitar una pieza."
              : "Toca una pieza tuya y luego una casilla marcada."}
          </p>
        </div>

        <div style={{ ...panelEstilo, flex: "0 1 320px", minWidth: 270 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong style={{ fontSize: 18 }}>{sala.nombre}</strong>
            {miColor && <Sello color={miColor} tamano={22} activo />}
          </div>

          {sala.fase === "esperando" && (
            <div style={{ marginTop: 14 }}>
              <Rotulo>Puestos</Rotulo>
              {EQUIPOS.map((equipo, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: LATON_CLARO, marginBottom: 4 }}>Bando {i + 1}</div>
                  {equipo.map((c) => (
                    <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <Sello color={c} tamano={18} />
                      <span style={{ flex: 1, fontSize: 14 }}>
                        {sala.puestos[c] ? sala.puestos[c].nombre : <em style={{ opacity: 0.6 }}>libre</em>}
                        <span style={{ color: LATON_CLARO, fontSize: 11 }}> · {ESTILO[c].lado}</span>
                      </span>
                      {soyAnfitrion && !sala.puestos[c] && (
                        <Boton variante="secundario" onClick={() => enviar({ tipo: "bot", sala: salaId, color: c })}>Bot</Boton>
                      )}
                      {sala.puestos[c] && sala.puestos[c].tipo === "bot" && (
                        soyAnfitrion ? (
                          <SelectorDeNivel
                            nivel={sala.puestos[c].nivel || 4}
                            onCambio={(n) => enviar({ tipo: "nivel", sala: salaId, color: c, nivel: n })}
                          />
                        ) : (
                          <span style={{ fontSize: 11, color: LATON_CLARO }}>
                            nivel {sala.puestos[c].nivel || 4}
                          </span>
                        )
                      )}
                      {soyAnfitrion && sala.puestos[c] && sala.puestos[c].tipo === "bot" && (
                        <Boton variante="peligro" onClick={() => enviar({ tipo: "librar", sala: salaId, color: c })}>Quitar</Boton>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {soyAnfitrion && (
                  <Boton onClick={() => enviar({ tipo: "empezar", sala: salaId })} disabled={!COLORES.every((c) => sala.puestos[c])}>
                    {COLORES.every((c) => sala.puestos[c]) ? "Empezar el despliegue" : "Faltan puestos"}
                  </Boton>
                )}
                <Boton
                  variante="secundario"
                  onClick={() => {
                    enviar({ tipo: "salir", sala: salaId });
                    setSalaId(null);
                  }}
                >
                  Dejar la partida
                </Boton>
              </div>
            </div>
          )}

          {sala.fase === "desplegando" && miColor && (
            <div style={{ marginTop: 14 }}>
              {yaDesplegado ? (
                <div>
                  <p style={{ fontSize: 15 }}>Despliegue enviado. Esperando a los demás bandos.</p>
                  <div style={{ fontSize: 13, color: "#C9BC9C" }}>{sala.desplegados.length} de 4 ejércitos listos.</div>
                </div>
              ) : (
                <>
                  <Rotulo>Piezas por colocar</Rotulo>
                  {restantes.map((r) => (
                    <button
                      key={r.rango}
                      onClick={() => setRangoActivo(r.rango)}
                      style={{
                        display: "flex",
                        width: "100%",
                        justifyContent: "space-between",
                        background: rangoActivo === r.rango ? MADERA_CLARA : "transparent",
                        border: `1px solid ${rangoActivo === r.rango ? LATON_CLARO : MADERA_CLARA}`,
                        borderRadius: 3,
                        color: r.quedan === 0 ? "#8d8371" : PERGAMINO,
                        padding: "5px 10px",
                        marginBottom: 3,
                        cursor: "pointer",
                        fontFamily: "Georgia, serif",
                        fontSize: 14,
                      }}
                    >
                      <span>
                        <strong style={{ color: LATON_CLARO }}>{r.rango}</strong> {r.nombre}
                      </span>
                      <span>{r.quedan}</span>
                    </button>
                  ))}
                  <div style={{ fontSize: 13, color: "#C9BC9C", margin: "10px 0" }}>
                    {Object.keys(colocacion).length} de 20 · bandera en {ZONAS[miColor].bandera}{" "}
                    {colocacion[ZONAS[miColor].bandera] ? "lista" : "sin pieza"}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Boton variante="secundario" onClick={() => setColocacion(colocacionAleatoria(miColor))}>Al azar</Boton>
                    <Boton variante="secundario" onClick={() => setColocacion({})}>Vaciar</Boton>
                    <Boton
                      variante="secundario"
                      onClick={() => {
                        const texto = despliegueComoRejilla(miColor, colocacion);
                        setRejillaCopiada(texto);
                        if (navigator.clipboard) navigator.clipboard.writeText(texto).catch(() => {});
                      }}
                    >
                      Copiar
                    </Boton>
                    <Boton onClick={() => enviar({ tipo: "despliegue", sala: salaId, colocacion })}>Confirmar</Boton>
                  </div>
                  {rejillaCopiada && (
                    <div style={{ marginTop: 10 }}>
                      <Rotulo>Copiado al portapapeles</Rotulo>
                      <textarea
                        readOnly
                        value={rejillaCopiada}
                        onFocus={(e) => e.target.select()}
                        rows={6}
                        style={{
                          ...entradaEstilo,
                          width: "100%",
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 12.5,
                          lineHeight: 1.5,
                          resize: "vertical",
                        }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {(sala.fase === "jugando" || sala.fase === "fin") && estado && (
            <div style={{ marginTop: 14 }}>
              {estado.fin ? (
                <div style={{ border: `1px solid ${LATON_CSS}`, borderRadius: 4, padding: 12, marginBottom: 12 }}>
                  <strong style={{ fontSize: 16 }}>
                    {estado.fin.ganador ? `Gana el bando ${estado.fin.equipo.join(" y ")}` : "Partida cerrada sin ganador"}
                  </strong>
                  {!estado.fin.ganador && estado.fin.motivo && (
                    <div style={{ fontSize: 13, color: "#C9BC9C", marginTop: 4 }}>{estado.fin.motivo}.</div>
                  )}
                  {/* Al terminar, el servidor manda los rangos de los cuatro
                      ejércitos y los despliegues iniciales, así que el tablero
                      se destapa solo y el informe ya tiene todo lo que necesita. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                    <Boton
                      variante="secundario"
                      onClick={() => {
                        if (!abrirInforme(sala)) setAviso("El navegador ha bloqueado la ventana del informe. Permite las ventanas emergentes de esta página.");
                      }}
                    >
                      Informe de la partida
                    </Boton>
                    {/* El análisis vuelve a jugar la partida varias veces desde
                        las posiciones dudosas, así que tarda unos segundos. Se
                        hace aquí y no en el servidor porque bloquearlo
                        congelaría los bots de todas las demás partidas. */}
                    <Boton
                      variante="secundario"
                      disabled={analizando}
                      onClick={async () => {
                        setAnalizando(true);
                        setAviso("");
                        try {
                          const analisis = await analizarEnElNavegador(sala);
                          if (!abrirInforme(sala, analisis)) {
                            setAviso("El navegador ha bloqueado la ventana del informe. Permite las ventanas emergentes de esta página.");
                          }
                        } catch (e) {
                          setAviso(`No se ha podido analizar: ${e.message}`);
                        } finally {
                          setAnalizando(false);
                        }
                      }}
                    >
                      {analizando ? "Analizando…" : "Informe con análisis"}
                    </Boton>
                    <span style={{ fontSize: 12, color: "#C9BC9C" }}>
                      Los rangos ya están destapados en el tablero.
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <Sello color={estado.turno} tamano={20} activo={esMiTurno} />
                  <span style={{ fontSize: 15 }}>
                    {esMiTurno ? "Te toca" : `Turno de ${sala.puestos[estado.turno]?.nombre || estado.turno}`}
                  </span>
                </div>
              )}

              {miColor && (
                <div style={{ fontSize: 13, color: "#C9BC9C", lineHeight: 1.6 }}>
                  Tu bando: {miColor} y {SOCIO[miColor]}
                  <br />
                  Tus bajas: {estado.misBajas.length ? estado.misBajas.join(", ") : "ninguna"}
                </div>
              )}

              <Marcador marcador={estado.marcador} miColor={miColor} />

              {estado.pendiente && estado.pendiente.tipo === "recoger" && (
                <div style={{ border: `1px solid ${LATON_CLARO}`, borderRadius: 4, padding: 12, marginTop: 12 }}>
                  <Rotulo>Tienes una bandera a los pies</Rotulo>
                  <p style={{ fontSize: 13.5, margin: "6px 0 10px", color: "#D9CFB6" }}>
                    La bandera de {estado.pendiente.bandera} está en {estado.pendiente.casilla}. Si la cargas,
                    esa pieza pasará a avanzar solo una casilla por turno.
                  </p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Boton onClick={() => enviar({ tipo: "recoger", sala: salaId, recoge: true })}>Recogerla</Boton>
                    <Boton variante="secundario" onClick={() => enviar({ tipo: "recoger", sala: salaId, recoge: false })}>
                      Dejarla en el suelo
                    </Boton>
                  </div>
                </div>
              )}

              {estado.pendiente && estado.pendiente.tipo === "reclutar" && (
                <div style={{ border: `1px solid ${LATON_CLARO}`, borderRadius: 4, padding: 12, marginTop: 12 }}>
                  <Rotulo>Reclutas una pieza</Rotulo>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {estado.pendiente.opciones.map((r) => (
                      <Boton key={r} onClick={() => enviar({ tipo: "reclutar", sala: salaId, rango: r })}>
                        {r} {NOMBRE_RANGO[r]}
                      </Boton>
                    ))}
                  </div>
                </div>
              )}

              {estado.eventos && estado.eventos.length > 0 && (
                <div style={{ marginTop: 12, fontSize: 13, background: "rgba(0,0,0,0.25)", padding: 10, borderRadius: 3 }}>
                  {estado.eventos
                    .map(describirEvento)
                    .filter(Boolean)
                    .map((t, i) => (
                      <div key={i} style={{ marginBottom: 4 }}>{t}</div>
                    ))}
                </div>
              )}

              <Historia historia={estado.historia} />

              {aviso && <p style={{ color: "#E8A9A4", fontSize: 13 }}>{aviso}</p>}

              <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Boton
                  variante="secundario"
                  onClick={() => {
                    enviar({ tipo: "salir", sala: salaId });
                    setSalaId(null);
                  }}
                >
                  Dejar la partida
                </Boton>
                {soyAnfitrion && !estado.fin && (
                  <Boton variante="peligro" onClick={() => setConfirmando("parar")}>
                    Parar partida
                  </Boton>
                )}
                {soyAnfitrion && (
                  <Boton variante="peligro" onClick={() => setConfirmando("borrar")}>
                    Borrar partida
                  </Boton>
                )}
              </div>

              {confirmando && (
                <div style={{ border: `1px solid #E8A9A4`, borderRadius: 4, padding: 12, marginTop: 10 }}>
                  <p style={{ fontSize: 13, marginTop: 0 }}>
                    {confirmando === "parar"
                      ? "Se cierra la partida para los cuatro jugadores. La sala y el hilo se quedan para repasarlos."
                      : "La sala desaparece para todos y no se puede recuperar."}
                  </p>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Boton
                      variante="peligro"
                      onClick={() => {
                        enviar({ tipo: confirmando, sala: salaId });
                        if (confirmando === "borrar") setSalaId(null);
                        setConfirmando(null);
                      }}
                    >
                      Sí, {confirmando === "parar" ? "parar" : "borrar"}
                    </Boton>
                    <Boton variante="secundario" onClick={() => setConfirmando(null)}>
                      Cancelar
                    </Boton>
                  </div>
                </div>
              )}
            </div>
          )}

          {aviso && sala.fase === "desplegando" && <p style={{ color: "#E8A9A4", fontSize: 13 }}>{aviso}</p>}
        </div>
      </div>
    </div>
  );
}
