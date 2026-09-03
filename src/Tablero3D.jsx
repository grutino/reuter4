import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { CASILLAS, COLORES, LAGOS, CASTILLO_HUELLA, ANILLO, TORRE, ZONAS, coord, zonaDe, casillasDeZona } from "./motor/tablero.js";
import { pintarFicha } from "./ficha.js";

import { ESTILO, NOMBRE_RANGO } from "./estilo.js";
import { madera, arena, piedra, ladrillo, cielo, normalDeAgua } from "./texturas.js";
export { ESTILO, NOMBRE_RANGO };
export const LATON_CSS = "#C08A2E";
const PERGAMINO = "#E8DCC2";

// === Tablero 3D =============================================================

// Cuánto se gira la cara de la ficha según el ejército al que pertenece. El
// plano está tumbado (rotación -PI/2 en X), así que el giro va en Z.
const GIRO_DE_FICHA = {
  rojo: Math.PI,        // norte: la cabeza hacia el sur, o sea al centro
  azul: 0,              // sur
  verde: Math.PI / 2,   // este
  amarillo: -Math.PI / 2, // oeste
};

const GEO = {};
function geometrias() {
  if (GEO.listo) return GEO;
  GEO.casilla = new THREE.BoxGeometry(0.94, 0.1, 0.94);
  GEO.lago = new THREE.BoxGeometry(0.98, 0.06, 0.98);
  GEO.cuerpo = new THREE.CylinderGeometry(0.33, 0.37, 0.5, 18);
  GEO.aro = new THREE.TorusGeometry(0.34, 0.035, 8, 18);
  GEO.tapa = new THREE.CircleGeometry(0.3, 20);
  GEO.asta = new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6);
  GEO.pano = new THREE.PlaneGeometry(0.42, 0.26);
  GEO.marca = new THREE.TorusGeometry(0.38, 0.045, 8, 20);
  GEO.aroSuelta = new THREE.TorusGeometry(0.3, 0.05, 8, 20);
  GEO.numero = new THREE.PlaneGeometry(0.72, 0.72);
  GEO.quemadura = new THREE.CircleGeometry(0.46, 20);
  GEO.llama = new THREE.ConeGeometry(0.17, 0.42, 7);
  GEO.carbon = new THREE.DodecahedronGeometry(0.075, 0);
  GEO.listo = true;
  return GEO;
}

const CACHE_TEXTURAS = {};
const CACHE_NUMEROS = {};

// El contador de victorias camino del reclutamiento, escrito sobre la casilla de
// reclutamiento de cada ejército. Estaba solo en el panel lateral, y es un dato
// que se mira constantemente mientras se juega: tenerlo en el tablero ahorra
// apartar la vista.
function texturaNumero(n, colorCss) {
  const clave = `${n}-${colorCss}`;
  if (CACHE_NUMEROS[clave]) return CACHE_NUMEROS[clave];
  const lado = 128;
  const lienzo = document.createElement("canvas");
  lienzo.width = lienzo.height = lado;
  const ctx = lienzo.getContext("2d");
  ctx.font = "bold 92px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Halo claro debajo: el número tiene que leerse sobre la arena y sobre el
  // tinte del ejército, que son fondos distintos.
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(255, 248, 232, 0.92)";
  ctx.strokeText(String(n), lado / 2, lado / 2 + 4);
  ctx.fillStyle = colorCss;
  ctx.fillText(String(n), lado / 2, lado / 2 + 4);
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  CACHE_NUMEROS[clave] = textura;
  return textura;
}
// La ficha lleva la silueta del rango en oro sobre el color de su ejército, como
// en el tablero de cartón. Solo se pinta para las piezas propias: los rangos
// ajenos no se enseñan nunca sobre el tablero, ni siquiera los que ya se han
// visto en un combate. Eso se ve en su momento, en la ventana de combate, y a
// partir de ahí es cosa de la memoria del jugador.
function texturaRango(rango, color) {
  const clave = `${rango}-${color}`;
  if (CACHE_TEXTURAS[clave]) return CACHE_TEXTURAS[clave];
  const lienzo = document.createElement("canvas");
  lienzo.width = 128;
  lienzo.height = 128;
  pintarFicha(lienzo.getContext("2d"), rango, (ESTILO[color] && ESTILO[color].css) || null);
  const textura = new THREE.CanvasTexture(lienzo);
  CACHE_TEXTURAS[clave] = textura;
  return textura;
}

// Radio al que se reparten los focos de fuego sobre el anillo: entre el borde
// interior y el exterior de la corona de piedra.
const RADIO_ANILLO = 1.02;

function posicion3D(casilla) {
  if (casilla === ANILLO) return [0.95, 0.5, 0];
  if (casilla === TORRE) return [0, 1.35, 0];
  const [c, f] = coord(casilla);
  return [c - 7, 0.1, f - 8];
}

export default function Tablero3D({
  piezas,
  banderasSueltas,
  resaltadas,
  zonaPropia,
  colorCamara,
  marcador,
  explosiones,
  ultimaCasilla,
  onCasilla,
  alto = 540,
  ampliado = false,
  onAlternarAmpliado,
}) {
  const [leyendaAbierta, setLeyendaAbierta] = useState(false);
  const contenedor = useRef(null);
  const ref = useRef(null);
  const manejador = useRef(onCasilla);

  useEffect(() => {
    manejador.current = onCasilla;
  }, [onCasilla]);

  useEffect(() => {
    const nodo = contenedor.current;
    if (!nodo) return undefined;
    const g = geometrias();

    const escena = new THREE.Scene();
    const camara = new THREE.PerspectiveCamera(45, nodo.clientWidth / nodo.clientHeight, 0.1, 400);
    const render = new THREE.WebGLRenderer({ antialias: true });
    render.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    render.setSize(nodo.clientWidth, nodo.clientHeight);
    // Sombras y mapeo de tonos: es lo que convierte los colores planos en una
    // escena con volumen. ACES comprime las luces altas para que el sol no queme
    // la madera clara.
    render.shadowMap.enabled = true;
    render.shadowMap.type = THREE.PCFSoftShadowMap;
    render.toneMapping = THREE.ACESFilmicToneMapping;
    render.toneMappingExposure = 1.05;
    nodo.appendChild(render.domElement);

    // Cielo con nubes de fondo y como reflejo del entorno: los materiales de
    // piedra y agua lo usan para no verse muertos en las zonas de sombra.
    const textoCielo = cielo();
    escena.background = textoCielo;
    // Como iluminación de entorno se usa una versión prefiltrada, no la textura
    // cruda: three tendría que filtrarla al vuelo en cada material, y así se
    // hace una vez y se reparte. Es lo que le da al agua y a la piedra un
    // reflejo del cielo en vez de un gris muerto.
    const pmrem = new THREE.PMREMGenerator(render);
    const entorno = pmrem.fromEquirectangular(textoCielo).texture;
    escena.environment = entorno;
    pmrem.dispose();
    escena.fog = new THREE.Fog(0xb9d3e4, 46, 130);

    escena.add(new THREE.HemisphereLight(0xcfe3f2, 0x5a5540, 0.55));
    const sol = new THREE.DirectionalLight(0xfff1d6, 2.1);
    sol.position.set(11, 18, 8);
    sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048);
    sol.shadow.camera.near = 4;
    sol.shadow.camera.far = 60;
    // El encuadre de la sombra se ajusta al tablero: más ancho y se ve dentada,
    // más estrecho y las piezas del borde se quedan sin sombra.
    for (const [lado, valor] of [["left", -13], ["right", 13], ["top", 13], ["bottom", -13]]) {
      sol.shadow.camera[lado] = valor;
    }
    sol.shadow.bias = -0.0006;
    escena.add(sol);

    const marco = new THREE.Mesh(
      new THREE.BoxGeometry(19.5, 0.6, 19.5),
      new THREE.MeshStandardMaterial({ map: madera({ semilla: 11 }), roughness: 0.72, metalness: 0.02 })
    );
    marco.position.y = -0.35;
    marco.receiveShadow = true;
    escena.add(marco);

    const fieltro = new THREE.Mesh(
      new THREE.BoxGeometry(17.6, 0.1, 17.6),
      new THREE.MeshStandardMaterial({ map: madera({ semilla: 29, claro: [96, 66, 38], oscuro: [58, 38, 20] }), roughness: 0.85 })
    );
    fieltro.position.y = -0.02;
    fieltro.receiveShadow = true;
    escena.add(fieltro);

    const clicables = [];
    const casillasMesh = [];
    for (const casilla of CASILLAS) {
      if (casilla === ANILLO || casilla === TORRE) continue;
      const zc = zonaDe(casilla);
      const base = zc
        ? new THREE.Color(ESTILO[zc].hex).lerp(new THREE.Color(0xc2ab7e), 0.55)
        : new THREE.Color(0xc2ab7e);
      const malla = new THREE.Mesh(
        g.casilla,
        new THREE.MeshStandardMaterial({ map: arena(), color: base, roughness: 0.95, metalness: 0 })
      );
      malla.receiveShadow = true;
      const [x, y, z] = posicion3D(casilla);
      malla.position.set(x, y - 0.05, z);
      malla.userData = { casilla, base: base.clone() };
      escena.add(malla);
      casillasMesh.push(malla);
      clicables.push(malla);
    }

    // El agua: transparente, brillante y con el mapa de normales moviéndose. No
    // hay geometría que ondule —sería caro y no se notaría a esta escala— pero
    // el reflejo sí se mueve, y eso es lo que hace que parezca agua.
    const normalAgua = normalDeAgua();
    const materialAgua = new THREE.MeshStandardMaterial({
      color: 0x255a78,
      transparent: true,
      opacity: 0.86,
      roughness: 0.06,
      metalness: 0.15,
      normalMap: normalAgua,
      normalScale: new THREE.Vector2(1.7, 1.7),
      envMapIntensity: 2.2,
    });
    for (const lago of LAGOS) {
      const malla = new THREE.Mesh(g.lago, materialAgua);
      const [c, f] = coord(lago);
      malla.position.set(c - 7, 0.02, f - 8);
      escena.add(malla);
    }

    // --- Bosque y montañas en lo que no se pisa -------------------------------
    //
    // Las 60 casillas de fuera de juego eran madera lisa, y eso hacía que el
    // tablero pareciera acabarse antes de tiempo. Con árboles y rocas se lee de
    // un vistazo por dónde NO se puede pasar, que es información de juego y no
    // solo decoración.
    //
    // Van en mallas instanciadas: 60 casillas por dos o tres piezas cada una
    // serían casi doscientos objetos, y así son cuatro.
    {
      const jugables = new Set(CASILLAS);
      const huecos = [];
      for (let fila = 1; fila <= 15; fila++) {
        for (let col = 1; col <= 15; col++) {
          const casilla = String.fromCharCode(64 + col) + fila;
          if (jugables.has(casilla) || LAGOS.has(casilla) || CASTILLO_HUELLA.has(casilla)) continue;
          // OJO: se posiciona con `coord`, como todo lo demás de la escena. Su
          // convención es MIXTA -columna en base 0, fila en base 1- así que
          // usar aquí el contador del bucle, que va de 1 a 15, desplazaba el
          // bosque entero una columna. Es el mismo tropiezo que ya se dio al
          // dibujar el informe: si se posiciona con `coord` en un sitio, hay que
          // posicionar con `coord` en todos.
          const [cx, cf] = coord(casilla);
          huecos.push([cx - 7, cf - 8]);
        }
      }

      // Azar sembrado: el bosque tiene que salir igual en cada partida, o el
      // tablero parecería otro cada vez que se recarga.
      let semilla = 20260901 >>> 0;
      const azarBosque = () => {
        semilla = (semilla + 0x6d2b79f5) >>> 0;
        let x = semilla;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };

      const arboles = [];
      const rocas = [];
      for (const [x, z] of huecos) {
        // Dos o tres cosas por casilla, desperdigadas: en rejilla se vería la
        // cuadrícula y quedaría un huerto, no un bosque.
        const cuantos = 2 + Math.floor(azarBosque() * 2);
        for (let i = 0; i < cuantos; i++) {
          const dx = (azarBosque() - 0.5) * 0.8;
          const dz = (azarBosque() - 0.5) * 0.8;
          const escala = 0.55 + azarBosque() * 0.7;
          (azarBosque() < 0.78 ? arboles : rocas).push([x + dx, z + dz, escala, azarBosque() * Math.PI * 2]);
        }
      }

      const colocar = (lista, geometria, material, alturaBase) => {
        const malla = new THREE.InstancedMesh(geometria, material, lista.length);
        malla.castShadow = true;
        malla.receiveShadow = true;
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const eje = new THREE.Vector3(0, 1, 0);
        lista.forEach(([x, z, escala, giro], i) => {
          q.setFromAxisAngle(eje, giro);
          m.compose(
            new THREE.Vector3(x, alturaBase * escala, z),
            q,
            new THREE.Vector3(escala, escala, escala)
          );
          malla.setMatrixAt(i, m);
        });
        malla.instanceMatrix.needsUpdate = true;
        escena.add(malla);
        return malla;
      };

      const tronco = new THREE.CylinderGeometry(0.055, 0.085, 0.45, 5);
      const copa = new THREE.ConeGeometry(0.3, 0.85, 7);
      const canto = new THREE.DodecahedronGeometry(0.22, 0);
      const matTronco = new THREE.MeshStandardMaterial({ map: madera({ semilla: 61, claro: [92, 66, 42], oscuro: [54, 38, 24] }), roughness: 0.95 });
      const matCopa = new THREE.MeshStandardMaterial({ color: 0x3f6b3c, roughness: 0.95, metalness: 0 });
      const matRoca = new THREE.MeshStandardMaterial({ map: piedra({ semilla: 83, base: [120, 116, 108] }), roughness: 0.95, flatShading: true });

      colocar(arboles, tronco, matTronco, 0.22);
      colocar(arboles, copa, matCopa, 0.72);
      colocar(rocas, canto, matRoca, 0.14);
    }

    const baseCastillo = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.6, 0.35, 24),
      new THREE.MeshStandardMaterial({ map: piedra(), roughness: 0.9, metalness: 0.02 })
    );
    baseCastillo.position.y = 0.175;
    escena.add(baseCastillo);

    const anilloMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.66, 1.42, 28),
      new THREE.MeshStandardMaterial({ map: piedra({ semilla: 55 }), roughness: 0.88, side: THREE.DoubleSide })
    );
    anilloMesh.rotation.x = -Math.PI / 2;
    anilloMesh.position.y = 0.36;
    anilloMesh.userData = { casilla: ANILLO, base: new THREE.Color(0x9b968a) };
    escena.add(anilloMesh);
    clicables.push(anilloMesh);
    casillasMesh.push(anilloMesh);

    const torreMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.62, 1.0, 20),
      new THREE.MeshStandardMaterial({ map: ladrillo(), roughness: 0.85, metalness: 0.02 })
    );
    torreMesh.position.y = 0.85;
    // El fuste no es clicable -se pulsa la cima- pero sí se ilumina: cuando el
    // último lance ha sido en la torre, se enciende la torre ENTERA, no su tapa.
    torreMesh.userData = { casilla: TORRE, base: new THREE.Color(0xffffff), soloLuz: true };
    escena.add(torreMesh);

    const cima = new THREE.Mesh(
      new THREE.CircleGeometry(0.52, 22),
      new THREE.MeshStandardMaterial({ map: piedra({ semilla: 71 }), roughness: 0.9, side: THREE.DoubleSide })
    );
    cima.rotation.x = -Math.PI / 2;
    cima.position.y = 1.355;
    cima.userData = { casilla: TORRE, base: new THREE.Color(0x9b968a) };
    escena.add(cima);
    clicables.push(cima);
    casillasMesh.push(cima);
    casillasMesh.push(torreMesh);

    const corona = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 8, 24), new THREE.MeshLambertMaterial({ color: 0xb08d3f }));
    corona.rotation.x = Math.PI / 2;
    corona.position.y = 1.36;
    escena.add(corona);

    // La cámara orbita alrededor de `objetivo`, que además se puede desplazar:
    // girar y acercar no bastan para mirar una esquina del tablero de cerca.
    const INICIO = { radio: 21, theta: Math.PI, phi: 0.92 };
    const orbita = { ...INICIO };
    const objetivo = new THREE.Vector3(0, 0.4, 0);
    const LIMITE_DESPLAZAMIENTO = 11;

    function situarCamara() {
      camara.position.set(
        objetivo.x + orbita.radio * Math.sin(orbita.phi) * Math.sin(orbita.theta),
        objetivo.y + orbita.radio * Math.cos(orbita.phi),
        objetivo.z + orbita.radio * Math.sin(orbita.phi) * Math.cos(orbita.theta)
      );
      camara.lookAt(objetivo);
    }

    // Desplaza el objetivo por el plano del tablero, en las direcciones que el
    // jugador ve como "derecha" y "hacia el fondo" desde donde está mirando.
    function desplazar(dx, dy) {
      const paso = orbita.radio * 0.0016;
      const derecha = new THREE.Vector3(Math.cos(orbita.theta), 0, -Math.sin(orbita.theta));
      const fondo = new THREE.Vector3(-Math.sin(orbita.theta), 0, -Math.cos(orbita.theta));
      objetivo.addScaledVector(derecha, -dx * paso);
      objetivo.addScaledVector(fondo, dy * paso);
      objetivo.x = Math.max(-LIMITE_DESPLAZAMIENTO, Math.min(LIMITE_DESPLAZAMIENTO, objetivo.x));
      objetivo.z = Math.max(-LIMITE_DESPLAZAMIENTO, Math.min(LIMITE_DESPLAZAMIENTO, objetivo.z));
      situarCamara();
    }

    function centrarVista() {
      orbita.radio = INICIO.radio;
      orbita.phi = INICIO.phi;
      objetivo.set(0, 0.4, 0);
      situarCamara();
    }

    situarCamara();

    let arrastrando = false;
    let desplazando = false;
    let ultimo = { x: 0, y: 0 };
    let recorrido = 0;
    // Botón derecho, botón central o Mayúsculas: desplazar. Lo demás: girar.
    const esDesplazamiento = (e) => e.button === 1 || e.button === 2 || e.shiftKey;
    const alPulsar = (e) => {
      arrastrando = true;
      desplazando = esDesplazamiento(e);
      recorrido = 0;
      ultimo = { x: e.clientX, y: e.clientY };
      nodo.style.cursor = desplazando ? "move" : "grabbing";
    };
    const alMover = (e) => {
      if (!arrastrando) return;
      const dx = e.clientX - ultimo.x;
      const dy = e.clientY - ultimo.y;
      recorrido += Math.abs(dx) + Math.abs(dy);
      // Mayúsculas se mira en cada movimiento y no solo al pulsar: hay entornos
      // que no traen el modificador en el pointerdown, y así se puede además
      // alternar entre girar y desplazar sin soltar el botón.
      if (desplazando || e.shiftKey) {
        desplazar(dx, dy);
      } else {
        orbita.theta -= dx * 0.006;
        orbita.phi = Math.max(0.2, Math.min(1.45, orbita.phi - dy * 0.005));
        situarCamara();
      }
      ultimo = { x: e.clientX, y: e.clientY };
      nodo.style.cursor = desplazando || e.shiftKey ? "move" : "grabbing";
    };
    const alSoltar = () => {
      arrastrando = false;
      desplazando = false;
      nodo.style.cursor = "grab";
    };
    const alMenuContextual = (e) => e.preventDefault(); // el botón derecho desplaza

    // Teclado: flechas para desplazar y C para volver a la vista de partida.
    const alTeclear = (e) => {
      const etiqueta = e.target && e.target.tagName;
      if (etiqueta === "INPUT" || etiqueta === "TEXTAREA") return;
      const PASO = 26;
      if (e.key === "ArrowLeft") desplazar(PASO, 0);
      else if (e.key === "ArrowRight") desplazar(-PASO, 0);
      else if (e.key === "ArrowUp") desplazar(0, -PASO);
      else if (e.key === "ArrowDown") desplazar(0, PASO);
      else if (e.key === "c" || e.key === "C") centrarVista();
      else return;
      e.preventDefault();
    };
    const alRodar = (e) => {
      e.preventDefault();
      orbita.radio = Math.max(8, Math.min(36, orbita.radio + e.deltaY * 0.015));
      situarCamara();
    };
    const rayoRaton = new THREE.Raycaster();
    const puntero = new THREE.Vector2();
    const alClicar = (e) => {
      if (recorrido > 6) return;
      const caja = render.domElement.getBoundingClientRect();
      puntero.x = ((e.clientX - caja.left) / caja.width) * 2 - 1;
      puntero.y = -((e.clientY - caja.top) / caja.height) * 2 + 1;
      rayoRaton.setFromCamera(puntero, camara);
      const impactos = rayoRaton.intersectObjects(clicables, false);
      if (impactos.length && manejador.current) manejador.current(impactos[0].object.userData.casilla);
    };

    render.domElement.addEventListener("pointerdown", alPulsar);
    window.addEventListener("pointermove", alMover);
    window.addEventListener("pointerup", alSoltar);
    render.domElement.addEventListener("wheel", alRodar, { passive: false });
    render.domElement.addEventListener("click", alClicar);
    render.domElement.addEventListener("contextmenu", alMenuContextual);
    window.addEventListener("keydown", alTeclear);

    const grupoPiezas = new THREE.Group();
    escena.add(grupoPiezas);
    const grupoMarcas = new THREE.Group();
    escena.add(grupoMarcas);
    // Avisos: el contador de cada ejército y el fuego de los cañonazos. Grupo
    // aparte porque se repinta por razones distintas que las piezas.
    const grupoAvisos = new THREE.Group();
    escena.add(grupoAvisos);

    let vivo = true;
    const reloj = new THREE.Clock();
    const bucle = () => {
      if (!vivo) return;
      // El agua: se desplaza el mapa de normales en dos direcciones distintas
      // para que no se vea un patrón deslizando en bloque. No hay geometría que
      // ondule -no se notaría a esta escala y costaría- pero el reflejo sí se
      // mueve, que es lo que hace que parezca agua y no pintura azul.
      const t = reloj.getElapsedTime();
        normalAgua.offset.set(t * 0.22, t * 0.14);
      // Las llamas titilan: sin movimiento parecen conos naranjas clavados.
      for (const llama of (ref.current && ref.current.llamas) || []) {
        const p = Math.sin(t * 7 + llama.userData.fase);
        llama.scale.set(1 + p * 0.18, 1 + p * 0.3, 1 + p * 0.18);
        llama.material.emissiveIntensity = 1.3 + p * 0.5;
      }
      // La casilla del último lance late despacio. Fija se confunde con una
      // baldosa clara; latiendo se ve que está señalando algo, y despacio para
      // que no compita con las llamas, que titilan a 7 Hz.
      for (const material of (ref.current && ref.current.iluminadas) || []) {
        material.emissiveIntensity = 1.15 + Math.sin(t * 2.2) * 0.4;
      }
      render.render(escena, camara);
      requestAnimationFrame(bucle);
    };
    bucle();

    // Se observa el contenedor y no la ventana: al maximizar la escena cambia
    // de tamaño sin que la ventana se entere, y el lienzo se quedaría estirado.
    const alRedimensionar = () => {
      if (!nodo.clientWidth || !nodo.clientHeight) return;
      camara.aspect = nodo.clientWidth / nodo.clientHeight;
      camara.updateProjectionMatrix();
      render.setSize(nodo.clientWidth, nodo.clientHeight);
    };
    const observador = new ResizeObserver(alRedimensionar);
    observador.observe(nodo);

    ref.current = { escena, grupoPiezas, grupoMarcas, grupoAvisos, llamas: [], iluminadas: [], casillasMesh, orbita, situarCamara, centrarVista };

    return () => {
      vivo = false;
      observador.disconnect();
      window.removeEventListener("keydown", alTeclear);
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSoltar);
      render.domElement.removeEventListener("pointerdown", alPulsar);
      render.domElement.removeEventListener("wheel", alRodar);
      render.domElement.removeEventListener("click", alClicar);
      render.domElement.removeEventListener("contextmenu", alMenuContextual);
      render.dispose();
      if (render.domElement.parentNode) render.domElement.parentNode.removeChild(render.domElement);
    };
  }, []);

  useEffect(() => {
    const r = ref.current;
    if (!r || !colorCamara) return;
    // VERDE Y AMARILLO ESTABAN CAMBIADOS. La cámara se sitúa con
    // x = radio·sin(theta) y z = radio·cos(theta), así que theta = +PI/2 la pone
    // en +x —el este, donde está el verde— y -PI/2 en -x, el oeste del amarillo.
    // Con la tabla al revés, un jugador verde miraba el tablero desde el lado
    // del amarillo y al revés: veía su propio ejército al fondo.
    const angulo = { rojo: Math.PI, verde: Math.PI / 2, azul: 0, amarillo: -Math.PI / 2 };
    r.orbita.theta = angulo[colorCamara];
    r.situarCamara();
  }, [colorCamara]);

  useEffect(() => {
    const r = ref.current;
    if (!r) return;
    const marcas = resaltadas || {};
    const zona = zonaPropia ? new Set(casillasDeZona(zonaPropia)) : null;
    const g = geometrias();
    // Las que quedan encendidas laten despacio en el bucle de animación, así que
    // el bucle necesita saber cuáles son.
    r.iluminadas = [];

    while (r.grupoMarcas.children.length) {
      const hijo = r.grupoMarcas.children.pop();
      hijo.material.dispose();
    }

    for (const malla of r.casillasMesh) {
      const { casilla, base, soloLuz } = malla.userData;
      const tono = base.clone();
      const marca = marcas[casilla];

      // DÓNDE PASÓ LO ÚLTIMO. Con cuatro ejércitos moviendo, entre que te toca y
      // te vuelve a tocar han pasado tres jugadas que no has visto: sin esta
      // marca hay que reconstruirlas leyendo el hilo. El anillo y la torre se
      // encienden ENTEROS porque son una casilla lógica aunque ocupen varias
      // piezas de geometría: media torre iluminada se leería como otra cosa.
      const esLaUltima = ultimaCasilla && casilla === ultimaCasilla;
      if (malla.material.emissive) {
        malla.material.emissive.setHex(esLaUltima ? 0xffffff : 0x000000);
        malla.material.emissiveIntensity = esLaUltima ? 1.0 : 0;
        // La emisión con su propia textura como mapa: sin esto la torre se
        // convierte en un cilindro blanco liso y se pierde el ladrillo. Con el
        // mapa, lo que se ve es piedra ILUMINADA, que es lo que se pedía.
        malla.material.emissiveMap = esLaUltima ? malla.material.map || null : null;
        malla.material.needsUpdate = true;
        if (esLaUltima) r.iluminadas.push(malla.material);
      }
      if (soloLuz) {
        // El fuste de la torre conserva su ladrillo: solo aporta la luz.
        continue;
      }
      if (esLaUltima) tono.lerp(new THREE.Color(0xffffff), 0.55);

      if (zona) {
        if (casilla === ZONAS[zonaPropia].reclutamiento) tono.lerp(new THREE.Color(0x000000), 0.45);
        else if (casilla === ZONAS[zonaPropia].bandera) tono.lerp(new THREE.Color(0xf0e0b0), 0.5);
        else if (zona.has(casilla)) tono.lerp(new THREE.Color(0xffffff), 0.12);
        else tono.lerp(new THREE.Color(0x000000), 0.2);
      }
      if (marca === "seleccion") tono.lerp(new THREE.Color(0xe2bb6b), 0.65);
      if (marca === "mover") tono.lerp(new THREE.Color(0xd8e8c0), 0.45);
      if (marca === "atacar" || marca === "disparar") tono.lerp(new THREE.Color(0xe8938c), 0.55);
      malla.material.color.copy(tono);

      if (esLaUltima && casilla !== ANILLO && casilla !== TORRE) {
        const halo = new THREE.Mesh(g.marca, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        const [hx, hy, hz] = posicion3D(casilla);
        halo.rotation.x = Math.PI / 2;
        halo.position.set(hx, hy + 0.025, hz);
        r.grupoMarcas.add(halo);
      }

      if (marca && marca !== "seleccion") {
        const anillo = new THREE.Mesh(
          g.marca,
          new THREE.MeshBasicMaterial({ color: marca === "mover" ? 0x9fd07a : 0xd9534f })
        );
        const [x, y, z] = posicion3D(casilla);
        anillo.rotation.x = Math.PI / 2;
        anillo.position.set(x, y + 0.02, z);
        r.grupoMarcas.add(anillo);
      }
    }
    // Sonda para el banco de pruebas: sin esto, comprobar que una casilla queda
    // encendida obliga a fiarse de la captura, y a esta escala no se distingue.
    if (typeof window !== "undefined") window.__tablero3d = r;
  }, [resaltadas, zonaPropia, ultimaCasilla]);

  useEffect(() => {
    const r = ref.current;
    if (!r) return;
    const g = geometrias();
    while (r.grupoPiezas.children.length) {
      const hijo = r.grupoPiezas.children.pop();
      hijo.traverse((o) => {
        if (o.material && !o.material.map) o.material.dispose();
      });
    }
    for (const pieza of piezas || []) {
      const hex = ESTILO[pieza.color].hex;
      const grupo = new THREE.Group();
      const cuerpo = new THREE.Mesh(
        g.cuerpo,
        new THREE.MeshStandardMaterial({ map: piedra({ semilla: 41 }), color: hex, roughness: 0.78, metalness: 0.05 })
      );
      cuerpo.castShadow = true;
      cuerpo.receiveShadow = true;
      cuerpo.position.y = 0.25;
      grupo.add(cuerpo);
      const aro = new THREE.Mesh(g.aro, new THREE.MeshStandardMaterial({ color: 0xb08d3f, roughness: 0.35, metalness: 0.75 }));
      aro.rotation.x = Math.PI / 2;
      aro.position.y = 0.42;
      grupo.add(aro);
      // Solo se marca el rango de las piezas propias. Las ajenas van tapadas.
      const tapa = new THREE.Mesh(
        g.tapa,
        pieza.rango
          ? new THREE.MeshBasicMaterial({ map: texturaRango(pieza.rango, pieza.color) })
          : new THREE.MeshLambertMaterial({ color: 0x8d7742 })
      );
      tapa.rotation.x = -Math.PI / 2;
      // Cada ficha mira hacia el centro desde el lado de SU ejército, en vez de
      // salir todas giradas al sur. Así cada jugador ve sus piezas derechas sin
      // rodear el tablero, que es como están las de verdad sobre la mesa.
      tapa.rotation.z = GIRO_DE_FICHA[pieza.color] || 0;
      tapa.position.y = 0.505;
      grupo.add(tapa);

      if (pieza.bandera) {
        const asta = new THREE.Mesh(g.asta, new THREE.MeshLambertMaterial({ color: 0x5b4229 }));
        asta.position.set(0.18, 0.9, 0);
        grupo.add(asta);
        const pano = new THREE.Mesh(
          g.pano,
          // Con emisión propia: el paño es un plano, y la cara que da la espalda
          // al sol se quedaba negra desde que la escena tiene iluminación de
          // verdad. Una bandera tiene que leerse de su color por los dos lados.
          new THREE.MeshStandardMaterial({
            color: ESTILO[pieza.bandera].hex,
            emissive: ESTILO[pieza.bandera].hex,
            emissiveIntensity: 0.45,
            roughness: 0.85,
            side: THREE.DoubleSide,
          })
        );
        pano.position.set(0.4, 1.22, 0);
        grupo.add(pano);
      }

      const [x, y, z] = posicion3D(pieza.casilla);
      grupo.position.set(x, y, z);
      r.grupoPiezas.add(grupo);
    }

    // Banderas caídas en el suelo: sin pieza que las lleve. Van inclinadas, como
    // clavadas donde cayó su portador, y con un aro del color de la bandera para
    // poder localizarlas desde arriba sin girar la cámara.
    for (const [casilla, color] of Object.entries(banderasSueltas || {})) {
      if (!ESTILO[color]) continue;
      const grupo = new THREE.Group();

      const aro = new THREE.Mesh(g.aroSuelta, new THREE.MeshLambertMaterial({ color: ESTILO[color].hex }));
      aro.rotation.x = Math.PI / 2;
      aro.position.y = 0.06;
      grupo.add(aro);

      const asta = new THREE.Mesh(g.asta, new THREE.MeshLambertMaterial({ color: 0x5b4229 }));
      asta.rotation.z = Math.PI / 5;
      asta.position.set(-0.12, 0.42, 0);
      grupo.add(asta);

      const pano = new THREE.Mesh(
        g.pano,
        new THREE.MeshStandardMaterial({
          color: ESTILO[color].hex,
          emissive: ESTILO[color].hex,
          emissiveIntensity: 0.45,
          roughness: 0.85,
          side: THREE.DoubleSide,
        })
      );
      pano.position.set(0.12, 0.76, 0);
      grupo.add(pano);

      const [x, y, z] = posicion3D(casilla);
      grupo.position.set(x, y, z);
      r.grupoPiezas.add(grupo);
    }
  }, [piezas, banderasSueltas]);

  // El contador de cada ejército sobre su casilla de reclutamiento, y el fuego
  // que deja un cañonazo. Van en su propio grupo y su propio efecto porque
  // cambian por razones distintas que las piezas.
  useEffect(() => {
    const r = ref.current;
    if (!r) return;
    const g = geometrias();
    while (r.grupoAvisos.children.length) {
      const hijo = r.grupoAvisos.children.pop();
      if (hijo.material) hijo.material.dispose();
    }
    r.llamas = [];

    for (const color of COLORES) {
      const cuenta = marcador ? marcador[color] : 0;
      if (!cuenta) continue; // a cero no se pinta: sería ruido en 165 casillas
      const casilla = ZONAS[color].reclutamiento;
      const [x, , z] = posicion3D(casilla);
      const numero = new THREE.Mesh(
        g.numero,
        new THREE.MeshBasicMaterial({ map: texturaNumero(cuenta, ESTILO[color].css), transparent: true, depthWrite: false })
      );
      numero.rotation.x = -Math.PI / 2;
      numero.rotation.z = GIRO_DE_FICHA[color] || 0;
      // ALTURAS: la cara de la baldosa está en y = 0,10 -`posicion3D` devuelve
      // 0,1 y la caja se centra medio grosor por debajo-, así que todo lo que se
      // pinte encima va por arriba de eso. Puesto a 0,055 el número quedaba
      // DENTRO de la baldosa y no se veía; las llamas sí, porque iban a 0,2.
      // Si hay una pieza encima, el número a ras de baldosa queda DEBAJO del
      // disco, que es opaco: se pinta y no se ve. En ese caso sube por encima de
      // la ficha, que es donde de verdad se lee.
      const ocupada = (piezas || []).some((p) => p.casilla === casilla);
      numero.position.set(x, ocupada ? 0.56 : 0.108, z);
      r.grupoAvisos.add(numero);
    }

    // El rastro del cañonazo: quemadura en el suelo y unas llamas que titilan.
    // Dura lo que tarde en volverle el turno a quien disparó, que es el tiempo
    // que a un jugador le sirve para enterarse de que ha pasado algo ahí.
    for (const explosion of explosiones || []) {
      const casilla = explosion.casilla || explosion;
      const ardiendo = explosion.ardiendo !== false;
      // LA ALTURA IMPORTA: el anillo está a 0,5 y la torre a 1,35 sobre el
      // tablero. Antes se descartaba la que devuelve `posicion3D` y se pintaba
      // todo a ras de suelo, así que un cañonazo sobre el castillo quedaba
      // enterrado dentro de la piedra y no se veía.
      const [x, alturaCasilla, z] = posicion3D(casilla);
      if (x === undefined) continue;
      const suelo = alturaCasilla === undefined ? 0.1 : alturaCasilla;

      // EL ANILLO ES UNA CASILLA LÓGICA PERO OCHO CELDAS FÍSICAS, así que un
      // cañonazo ahí tiene que arder entero y no en un punto suelto: sobre el
      // tablero de verdad son G7 H7 I7 G8 I8 G9 H9 I9. La torre y las casillas
      // normales son una sola, así que un foco basta.
      // Los focos se sitúan alrededor del CENTRO del castillo, no del punto que
      // devuelve `posicion3D` para el anillo: ese está desplazado a propósito
      // para que una pieza sobre el anillo no quede dentro de la torre.
      const focos = [];
      if (casilla === ANILLO) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          focos.push([Math.cos(a) * RADIO_ANILLO - x, Math.sin(a) * RADIO_ANILLO - z]);
        }
      } else {
        focos.push([0, 0]);
      }

      for (const [dx, dz] of focos) {
        const fx = x + dx;
        const fz = z + dz;

        // Apagado el fuego quedan solo los carbones, sin el círculo negro: la
        // mancha acompaña a la llama mientras arde y se va con ella. Lo que
        // queda es el rastro, y no se va en toda la partida.
        if (!ardiendo) {
          for (let i = 0; i < 4; i++) {
            const angulo = (i / 4) * Math.PI * 2 + 0.7;
            const radio = 0.1 + (i % 2) * 0.11;
            const trozo = new THREE.Mesh(
              g.carbon,
              new THREE.MeshStandardMaterial({ color: 0x1c1815, roughness: 1, metalness: 0 })
            );
            trozo.position.set(fx + Math.cos(angulo) * radio, suelo + 0.03, fz + Math.sin(angulo) * radio);
            trozo.rotation.set(i * 0.9, i * 1.4, i * 0.5);
            trozo.scale.setScalar(0.7 + (i % 3) * 0.25);
            trozo.castShadow = true;
            r.grupoAvisos.add(trozo);
          }
          continue;
        }

        const quemadura = new THREE.Mesh(
          g.quemadura,
          new THREE.MeshBasicMaterial({ color: 0x2a1d14, transparent: true, opacity: 0.72, depthWrite: false })
        );
        quemadura.rotation.x = -Math.PI / 2;
        quemadura.position.set(fx, suelo + 0.004, fz);
        r.grupoAvisos.add(quemadura);

        for (let i = 0; i < 3; i++) {
          const llama = new THREE.Mesh(
            g.llama,
            new THREE.MeshStandardMaterial({
              color: i === 0 ? 0xffb03a : 0xd8471f,
              emissive: i === 0 ? 0xffa22a : 0xc63c14,
              emissiveIntensity: 1.6,
              transparent: true,
              opacity: 0.85,
              roughness: 1,
            })
          );
          const angulo = (i / 3) * Math.PI * 2;
          llama.position.set(fx + Math.cos(angulo) * 0.15, suelo + 0.22 + i * 0.03, fz + Math.sin(angulo) * 0.15);
          llama.userData.fase = i * 1.7 + dx * 3;
          r.grupoAvisos.add(llama);
          r.llamas.push(llama);
        }
      }
    }
  }, [marcador, explosiones, piezas]);

  const botonEscena = {
    background: "rgba(28,20,13,0.78)",
    color: PERGAMINO,
    border: `1px solid ${LATON_CSS}`,
    borderRadius: 4,
    padding: "4px 9px",
    fontSize: 12,
    fontFamily: "inherit",
    cursor: "pointer",
    lineHeight: 1.4,
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        // Ampliada, la escena se reparte el alto con el pie de ayuda en vez de
        // pedir un 100% que se desbordaría.
        ...(ampliado ? { flex: 1, minHeight: 0 } : { height: alto }),
        borderRadius: 6,
        overflow: "hidden",
        border: `2px solid ${LATON_CSS}`,
      }}
    >
      {/* El lienzo se cuelga aquí a mano, así que este nodo no lleva hijos de React. */}
      <div ref={contenedor} style={{ position: "absolute", inset: 0, cursor: "grab" }} />

      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
        <button
          type="button"
          style={botonEscena}
          onClick={() => setLeyendaAbierta((v) => !v)}
          title="Controles de la escena"
        >
          {leyendaAbierta ? "Ocultar controles" : "Controles"}
        </button>
        {onAlternarAmpliado && (
          <button type="button" style={botonEscena} onClick={onAlternarAmpliado} title="Tecla M">
            {ampliado ? "Reducir" : "Ampliar"}
          </button>
        )}
      </div>

      {leyendaAbierta && (
        <div
          style={{
            position: "absolute",
            top: 42,
            right: 8,
            background: "rgba(28,20,13,0.88)",
            border: `1px solid ${LATON_CSS}`,
            borderRadius: 4,
            padding: "9px 11px",
            fontSize: 12,
            lineHeight: 1.75,
            color: PERGAMINO,
            maxWidth: 250,
          }}
        >
          {[
            ["Arrastrar", "girar la vista"],
            ["Mayúsculas + arrastrar", "desplazar"],
            ["Botón derecho o central", "desplazar"],
            ["Flechas", "desplazar"],
            ["Rueda", "acercar y alejar"],
            ["C", "volver a la vista inicial"],
            ["M", "ampliar o reducir la escena"],
          ].map(([tecla, que]) => (
            <div key={tecla} style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
              <span style={{ color: LATON_CSS, whiteSpace: "nowrap" }}>{tecla}</span>
              <span style={{ textAlign: "right" }}>{que}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
