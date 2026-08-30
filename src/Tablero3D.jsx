import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import { CASILLAS, LAGOS, ANILLO, TORRE, ZONAS, coord, zonaDe, casillasDeZona } from "./motor/tablero.js";
import { dibujarSilueta } from "./siluetas.js";

export const ESTILO = {
  rojo: { hex: 0xa8322c, css: "#A8322C", lado: "Norte" },
  verde: { hex: 0x3a7a4a, css: "#3A7A4A", lado: "Este" },
  azul: { hex: 0x33589b, css: "#33589B", lado: "Sur" },
  amarillo: { hex: 0xc89b24, css: "#C89B24", lado: "Oeste" },
};

export const NOMBRE_RANGO = {
  9: "Mariscal", 8: "General", 7: "Comandante", 6: "Capitán", 5: "Teniente",
  4: "Sargento", 3: "Explorador", 2: "Espía", 1: "Cañón",
};

export const LATON_CSS = "#C08A2E";

// === Tablero 3D =============================================================

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
  GEO.listo = true;
  return GEO;
}

const CACHE_TEXTURAS = {};
// La ficha lleva la silueta del rango en oro sobre el color de su ejército, como
// en el tablero de cartón. Dos acabados: el normal y uno para los rangos que has
// deducido de lo que ha pasado en la mesa, marcado con un aro discontinuo para
// que no se confunda lo que sabes con certeza con lo que has averiguado.
const ORO = "#E9C979";
const BORDE_FICHA = "#1E1A14";

function texturaRango(rango, color, revelado = false) {
  const clave = `${rango}-${color}${revelado ? "-rev" : ""}`;
  if (CACHE_TEXTURAS[clave]) return CACHE_TEXTURAS[clave];
  const fondo = (ESTILO[color] && ESTILO[color].css) || "#5B4229";
  const lienzo = document.createElement("canvas");
  lienzo.width = 128;
  lienzo.height = 128;
  const ctx = lienzo.getContext("2d");

  ctx.fillStyle = fondo;
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = BORDE_FICHA;
  ctx.lineWidth = 5;
  ctx.stroke();

  // La silueta se recorta al disco para que nada se salga por los bordes.
  ctx.save();
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = ORO;
  ctx.strokeStyle = ORO;
  if (!dibujarSilueta(ctx, rango, { hueco: fondo })) {
    ctx.font = "bold 66px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(rango), 64, 64);
  }
  ctx.restore();

  if (revelado) {
    ctx.strokeStyle = "#F2E4C0";
    ctx.setLineDash([9, 7]);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(64, 64, 53, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const textura = new THREE.CanvasTexture(lienzo);
  CACHE_TEXTURAS[clave] = textura;
  return textura;
}

function posicion3D(casilla) {
  if (casilla === ANILLO) return [0.95, 0.5, 0];
  if (casilla === TORRE) return [0, 1.35, 0];
  const [c, f] = coord(casilla);
  return [c - 7, 0.1, f - 8];
}

export default function Tablero3D({
  piezas,
  banderasSueltas,
  rangosRevelados,
  resaltadas,
  zonaPropia,
  colorCamara,
  onCasilla,
}) {
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
    escena.background = new THREE.Color(0x1d2b23);
    const camara = new THREE.PerspectiveCamera(45, nodo.clientWidth / nodo.clientHeight, 0.1, 200);
    const render = new THREE.WebGLRenderer({ antialias: true });
    render.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    render.setSize(nodo.clientWidth, nodo.clientHeight);
    nodo.appendChild(render.domElement);

    escena.add(new THREE.HemisphereLight(0xf3e7cd, 0x2b3327, 0.9));
    const sol = new THREE.DirectionalLight(0xfff2d8, 0.7);
    sol.position.set(9, 16, 7);
    escena.add(sol);

    const marco = new THREE.Mesh(new THREE.BoxGeometry(19.5, 0.6, 19.5), new THREE.MeshLambertMaterial({ color: 0x3a2a1c }));
    marco.position.y = -0.35;
    escena.add(marco);
    const fieltro = new THREE.Mesh(new THREE.BoxGeometry(17.6, 0.1, 17.6), new THREE.MeshLambertMaterial({ color: 0x2f4436 }));
    fieltro.position.y = -0.02;
    escena.add(fieltro);

    const clicables = [];
    const casillasMesh = [];
    for (const casilla of CASILLAS) {
      if (casilla === ANILLO || casilla === TORRE) continue;
      const zc = zonaDe(casilla);
      const base = zc
        ? new THREE.Color(ESTILO[zc].hex).lerp(new THREE.Color(0xc2ab7e), 0.55)
        : new THREE.Color(0xc2ab7e);
      const malla = new THREE.Mesh(g.casilla, new THREE.MeshLambertMaterial({ color: base }));
      const [x, y, z] = posicion3D(casilla);
      malla.position.set(x, y - 0.05, z);
      malla.userData = { casilla, base: base.clone() };
      escena.add(malla);
      casillasMesh.push(malla);
      clicables.push(malla);
    }

    for (const lago of LAGOS) {
      const malla = new THREE.Mesh(g.lago, new THREE.MeshLambertMaterial({ color: 0x3f6f8f }));
      const [c, f] = coord(lago);
      malla.position.set(c - 7, 0.02, f - 8);
      escena.add(malla);
    }

    const baseCastillo = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.6, 0.35, 24),
      new THREE.MeshLambertMaterial({ color: 0x8d8878 })
    );
    baseCastillo.position.y = 0.175;
    escena.add(baseCastillo);

    const anilloMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.66, 1.42, 28),
      new THREE.MeshLambertMaterial({ color: 0x9b968a, side: THREE.DoubleSide })
    );
    anilloMesh.rotation.x = -Math.PI / 2;
    anilloMesh.position.y = 0.36;
    anilloMesh.userData = { casilla: ANILLO, base: new THREE.Color(0x9b968a) };
    escena.add(anilloMesh);
    clicables.push(anilloMesh);
    casillasMesh.push(anilloMesh);

    const torreMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.62, 1.0, 20),
      new THREE.MeshLambertMaterial({ color: 0x7e7a6d })
    );
    torreMesh.position.y = 0.85;
    escena.add(torreMesh);

    const cima = new THREE.Mesh(
      new THREE.CircleGeometry(0.52, 22),
      new THREE.MeshLambertMaterial({ color: 0x9b968a, side: THREE.DoubleSide })
    );
    cima.rotation.x = -Math.PI / 2;
    cima.position.y = 1.355;
    cima.userData = { casilla: TORRE, base: new THREE.Color(0x9b968a) };
    escena.add(cima);
    clicables.push(cima);
    casillasMesh.push(cima);

    const corona = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 8, 24), new THREE.MeshLambertMaterial({ color: 0xb08d3f }));
    corona.rotation.x = Math.PI / 2;
    corona.position.y = 1.36;
    escena.add(corona);

    const orbita = { radio: 21, theta: Math.PI, phi: 0.92 };
    function situarCamara() {
      camara.position.set(
        orbita.radio * Math.sin(orbita.phi) * Math.sin(orbita.theta),
        orbita.radio * Math.cos(orbita.phi),
        orbita.radio * Math.sin(orbita.phi) * Math.cos(orbita.theta)
      );
      camara.lookAt(0, 0.4, 0);
    }
    situarCamara();

    let arrastrando = false;
    let ultimo = { x: 0, y: 0 };
    let recorrido = 0;
    const alPulsar = (e) => {
      arrastrando = true;
      recorrido = 0;
      ultimo = { x: e.clientX, y: e.clientY };
    };
    const alMover = (e) => {
      if (!arrastrando) return;
      const dx = e.clientX - ultimo.x;
      const dy = e.clientY - ultimo.y;
      recorrido += Math.abs(dx) + Math.abs(dy);
      orbita.theta -= dx * 0.006;
      orbita.phi = Math.max(0.2, Math.min(1.45, orbita.phi - dy * 0.005));
      ultimo = { x: e.clientX, y: e.clientY };
      situarCamara();
    };
    const alSoltar = () => {
      arrastrando = false;
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

    const grupoPiezas = new THREE.Group();
    escena.add(grupoPiezas);
    const grupoMarcas = new THREE.Group();
    escena.add(grupoMarcas);

    let vivo = true;
    const bucle = () => {
      if (!vivo) return;
      render.render(escena, camara);
      requestAnimationFrame(bucle);
    };
    bucle();

    const alRedimensionar = () => {
      if (!nodo.clientWidth) return;
      camara.aspect = nodo.clientWidth / nodo.clientHeight;
      camara.updateProjectionMatrix();
      render.setSize(nodo.clientWidth, nodo.clientHeight);
    };
    window.addEventListener("resize", alRedimensionar);

    ref.current = { escena, grupoPiezas, grupoMarcas, casillasMesh, orbita, situarCamara };

    return () => {
      vivo = false;
      window.removeEventListener("resize", alRedimensionar);
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSoltar);
      render.domElement.removeEventListener("pointerdown", alPulsar);
      render.domElement.removeEventListener("wheel", alRodar);
      render.domElement.removeEventListener("click", alClicar);
      render.dispose();
      if (render.domElement.parentNode) render.domElement.parentNode.removeChild(render.domElement);
    };
  }, []);

  useEffect(() => {
    const r = ref.current;
    if (!r || !colorCamara) return;
    const angulo = { rojo: Math.PI, verde: -Math.PI / 2, azul: 0, amarillo: Math.PI / 2 };
    r.orbita.theta = angulo[colorCamara];
    r.situarCamara();
  }, [colorCamara]);

  useEffect(() => {
    const r = ref.current;
    if (!r) return;
    const marcas = resaltadas || {};
    const zona = zonaPropia ? new Set(casillasDeZona(zonaPropia)) : null;
    const g = geometrias();

    while (r.grupoMarcas.children.length) {
      const hijo = r.grupoMarcas.children.pop();
      hijo.material.dispose();
    }

    for (const malla of r.casillasMesh) {
      const { casilla, base } = malla.userData;
      const tono = base.clone();
      const marca = marcas[casilla];
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
  }, [resaltadas, zonaPropia]);

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
      const cuerpo = new THREE.Mesh(g.cuerpo, new THREE.MeshLambertMaterial({ color: hex }));
      cuerpo.position.y = 0.25;
      grupo.add(cuerpo);
      const aro = new THREE.Mesh(g.aro, new THREE.MeshLambertMaterial({ color: 0xb08d3f }));
      aro.rotation.x = Math.PI / 2;
      aro.position.y = 0.42;
      grupo.add(aro);
      // El rango propio se sabe; el ajeno solo si la mesa lo ha destapado.
      const deducido = pieza.rango ? null : (rangosRevelados || {})[pieza.id];
      const rangoVisible = pieza.rango || deducido;
      const tapa = new THREE.Mesh(
        g.tapa,
        rangoVisible
          ? new THREE.MeshBasicMaterial({ map: texturaRango(rangoVisible, pieza.color, Boolean(deducido)) })
          : new THREE.MeshLambertMaterial({ color: 0x8d7742 })
      );
      tapa.rotation.x = -Math.PI / 2;
      tapa.position.y = 0.505;
      grupo.add(tapa);

      if (pieza.bandera) {
        const asta = new THREE.Mesh(g.asta, new THREE.MeshLambertMaterial({ color: 0x5b4229 }));
        asta.position.set(0.18, 0.9, 0);
        grupo.add(asta);
        const pano = new THREE.Mesh(
          g.pano,
          new THREE.MeshLambertMaterial({ color: ESTILO[pieza.bandera].hex, side: THREE.DoubleSide })
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
        new THREE.MeshLambertMaterial({ color: ESTILO[color].hex, side: THREE.DoubleSide })
      );
      pano.position.set(0.12, 0.76, 0);
      grupo.add(pano);

      const [x, y, z] = posicion3D(casilla);
      grupo.position.set(x, y, z);
      r.grupoPiezas.add(grupo);
    }
  }, [piezas, banderasSueltas, rangosRevelados]);

  return (
    <div
      ref={contenedor}
      style={{ width: "100%", height: 540, borderRadius: 6, overflow: "hidden", border: `2px solid ${LATON_CSS}`, cursor: "grab" }}
    />
  );
}
