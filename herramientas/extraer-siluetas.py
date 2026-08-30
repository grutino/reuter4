#!/usr/bin/env python3
"""Saca las nueve siluetas de rango de una foto de la tarjeta de referencia.

Uso:
    python3 herramientas/extraer-siluetas.py RUTA_IMAGEN > src/siluetas-datos.js

Los valores por defecto de --cierre y --umbral son los que se usaron para generar
el fichero que está en el repositorio; se eligieron comparando las nueve fichas a
tamaño real, que es donde se decide si una silueta se lee o no.

La imagen de partida es una tira con los nueve rangos en fila, figuras claras
sobre fondo azul y el número debajo de cada una. El guion:

  1. marca como figura todo lo que NO es el azul del fondo (así entran tanto el
     oro claro como las sombras y los contornos oscuros),
  2. recorta por debajo de la fila de los números,
  3. cierra el trazo y quita las manchitas sueltas,
  4. parte la tira en nueve por los huecos verticales,
  5. rellena los huecos interiores, porque una sombra es sólida,
  6. saca una segunda capa con el dibujo interior -las zonas oscuras de dentro
     de la figura-, que luego se graba en la sombra con el color del fondo, y
  7. escupe un módulo JS con las dos máscaras codificadas por longitudes de racha.

La capa interior se recorta al interior erosionado de la figura, para que el
borde exterior de la sombra quede siempre entero y la pieza se siga leyendo de
un vistazo.

La imagen de origen no se guarda en el repositorio: es una foto del material
del juego. Lo que se versiona es la silueta derivada.
"""

from PIL import Image
import numpy as np
from collections import deque
import sys

import argparse
_p = argparse.ArgumentParser(description="Extrae las nueve siluetas de rango de una tira de referencia.")
_p.add_argument("imagen", help="foto de la tarjeta con los nueve rangos en fila")
_p.add_argument("--cierre", type=int, default=1,
                help="pasadas de cierre morfológico; más alto une trazos rotos pero macizo la figura")
_p.add_argument("--umbral", type=int, default=14,
                help="por debajo de este nivel de oro, dentro de la figura, es dibujo interior")
_args = _p.parse_args()
RUTA = _args.imagen
RANGOS=[9,8,7,6,5,4,3,2,1]
CORTE_Y = 133   # por debajo empiezan los números

def desplazar(m, dy, dx):
    s = np.zeros_like(m)
    H,W = m.shape
    ys0, ys1 = max(0,dy), min(H, H+dy)
    xs0, xs1 = max(0,dx), min(W, W+dx)
    yd0, yd1 = max(0,-dy), min(H, H-dy)
    xd0, xd1 = max(0,-dx), min(W, W-dx)
    s[ys0:ys1, xs0:xs1] = m[yd0:yd1, xd0:xd1]
    return s

VECINOS = [(dy,dx) for dy in (-1,0,1) for dx in (-1,0,1)]

def dilatar(m, veces=1):
    for _ in range(veces):
        acc = np.zeros_like(m)
        for dy,dx in VECINOS: acc |= desplazar(m,dy,dx)
        m = acc
    return m

def erosionar(m, veces=1):
    for _ in range(veces):
        acc = np.ones_like(m)
        for dy,dx in VECINOS: acc &= desplazar(m,dy,dx)
        m = acc
    return m

def componentes(m, minimo):
    visto = np.zeros_like(m, bool); salida = np.zeros_like(m, bool)
    H,W = m.shape
    for y in range(H):
        for x in range(W):
            if not m[y,x] or visto[y,x]: continue
            cola=deque([(y,x)]); visto[y,x]=True; celdas=[]
            while cola:
                cy,cx=cola.popleft(); celdas.append((cy,cx))
                for dy,dx in VECINOS:
                    ny,nx=cy+dy,cx+dx
                    if 0<=ny<H and 0<=nx<W and m[ny,nx] and not visto[ny,nx]:
                        visto[ny,nx]=True; cola.append((ny,nx))
            if len(celdas)>=minimo:
                for cy,cx in celdas: salida[cy,cx]=True
    return salida

def rellenar_huecos(m):
    """Marca como figura todo lo cerrado: una sombra es sólida."""
    H,W = m.shape
    libre = ~m
    alcanzado = np.zeros_like(m, bool)
    cola=deque()
    for x in range(W):
        for y in (0,H-1):
            if libre[y,x] and not alcanzado[y,x]: alcanzado[y,x]=True; cola.append((y,x))
    for y in range(H):
        for x in (0,W-1):
            if libre[y,x] and not alcanzado[y,x]: alcanzado[y,x]=True; cola.append((y,x))
    while cola:
        cy,cx=cola.popleft()
        for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny,nx=cy+dy,cx+dx
            if 0<=ny<H and 0<=nx<W and libre[ny,nx] and not alcanzado[ny,nx]:
                alcanzado[ny,nx]=True; cola.append((ny,nx))
    return m | (libre & ~alcanzado)

def grupos_columnas(m, hueco_max=14):
    cols = m.sum(axis=0); grupos=[]; ini=None; ultimo=None
    for x in range(m.shape[1]):
        if cols[x]>0:
            if ini is None: ini=x
            ultimo=x
        elif ini is not None and x-ultimo>hueco_max:
            grupos.append((ini,ultimo)); ini=None
    if ini is not None: grupos.append((ini,ultimo))
    return grupos

UMBRAL_ORO = _args.umbral
MARGEN_BORDE = 2    # píxeles de sombra maciza que se respetan en el contorno

def extraer(ruta):
    a = np.asarray(Image.open(ruta).convert("RGB")).astype(int)
    R,G,B = a[:,:,0], a[:,:,1], a[:,:,2]
    oro = (R+G)/2 - B
    fig = ~((B > R + 20) & (B > G + 20))
    fig[CORTE_Y:,:] = False
    fig[:2,:] = False
    fig = componentes(fig, 20)
    fig = dilatar(fig, _args.cierre); fig = erosionar(fig, _args.cierre)  # une trazos rotos
    grupos = grupos_columnas(fig)
    if len(grupos)!=9:
        raise SystemExit(f"esperaba 9 figuras y salieron {len(grupos)}: {grupos}")
    recortes={}
    for (x0,x1),rango in zip(grupos, RANGOS):
        sub = fig[:, x0:x1+1].copy()
        sub = rellenar_huecos(sub)
        sub = componentes(sub, 120)
        ys=np.where(sub.any(axis=1))[0]; xs=np.where(sub.any(axis=0))[0]
        y0,y1,c0,c1 = ys.min(), ys.max()+1, xs.min(), xs.max()+1
        figura = sub[y0:y1, c0:c1]
        # Dibujo interior: lo oscuro de dentro, sin morder el borde exterior.
        oscuro = (oro[:, x0:x1+1] <= UMBRAL_ORO)[y0:y1, c0:c1]
        interior = erosionar(figura, MARGEN_BORDE)
        hueco = componentes(oscuro & interior, 12)
        recortes[rango] = (figura, hueco)
    return recortes

def a_rachas(m):
    """Longitudes alternas empezando por fondo, recorriendo por filas."""
    plano = m.flatten()
    rachas=[]; actual=False; cuenta=0
    for v in plano:
        if bool(v)==actual: cuenta+=1
        else: rachas.append(cuenta); actual=bool(v); cuenta=1
    rachas.append(cuenta)
    return rachas

if __name__ == "__main__":
    rec = extraer(RUTA)
    print("// GENERADO por herramientas/extraer-siluetas.py. No editar a mano.")
    print("//")
    print("// Siluetas de los nueve rangos, sacadas de la tarjeta de referencia del")
    print("// juego. Cada rango trae dos máscaras de 1 bit del mismo tamaño:")
    print("//   figura: la sombra maciza")
    print("//   hueco:  el dibujo interior, que se graba encima con el color del fondo")
    print("// Las dos van codificadas por longitudes de racha: `tramos` alterna apagado")
    print("// y encendido empezando por apagado, recorriendo la máscara por filas.")
    print()
    print("export const SILUETAS = {")
    for rango in RANGOS:
        figura, hueco = rec[rango]
        rf, rh = a_rachas(figura), a_rachas(hueco)
        assert sum(rf) == figura.size and sum(rh) == hueco.size
        print(f"  {rango}: {{")
        print(f"    ancho: {figura.shape[1]}, alto: {figura.shape[0]},")
        print(f"    figura: [{','.join(str(v) for v in rf)}],")
        print(f"    hueco: [{','.join(str(v) for v in rh)}],")
        print("  },")
    print("};")
