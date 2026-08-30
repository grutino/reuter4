// La censura: qué ve cada jugador de una sala.
//
// Vive en su propio módulo y no dentro del servidor por una razón concreta: el
// servidor abre el puerto al importarse, así que su censura no se podía probar.
// Y esta es LA función que no puede fallar —si se filtra un rango, el juego deja
// de tener sentido y no falla nada—, así que tiene que ser testeable.
//
// Antes había dos censuras paralelas, esta y `vistaDe` en el motor, con un aviso
// en CLAUDE.md de que había que tocar las dos a la vez. Siguen siendo dos, pero
// ahora las dos tienen prueba.

import { COLORES } from "../src/motor/tablero.js";

// Cuántas jugadas del hilo se mandan en juego. `repartir` reenvía todas las
// salas a todos los clientes en cada cambio, así que el historial completo se
// multiplicaría en cada mensaje. Se manda solo la cola, y solo a quien juega.
export const HISTORIA_ENVIADA = 80;

export function colorDe(sala, idJugador) {
  return COLORES.find((c) => sala.puestos[c] && sala.puestos[c].id === idJugador) || null;
}

// Lo que se manda a cada cliente: rangos propios, bajas propias, nada más.
export function salaParaJugador(sala, idJugador) {
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

  // AL TERMINAR SE DESTAPA TODO. Es la única situación en la que se mandan los
  // rangos ajenos, y por eso la condición mira `e.fin` y no `sala.fase`: la fase
  // puede quedar en "fin" por otros caminos, y aquí lo que importa es que la
  // partida ya no pueda continuar. Mientras `e.fin` sea null no sale un solo
  // rango ajeno, que es la invariante de toda la vida.
  const terminada = Boolean(e.fin);

  return {
    ...base,
    // Los despliegues iniciales, para el informe de fin de partida. Contienen
    // los rangos de los cuatro ejércitos, así que solo al terminar.
    despliegues: terminada ? sala.despliegues : undefined,
    estado: {
      turno: e.turno,
      fin: e.fin,
      eventos: e.eventos,
      // El hilo solo contiene lo que ya se emitió como evento: jugadas, duelos y
      // banderas. Ningún rango oculto, así que se puede mandar tal cual.
      // En juego se manda solo la cola, que es lo que el hilo enseña. Al terminar
      // va entera, porque el informe la necesita completa.
      historia: terminada ? e.historia || [] : miColor ? (e.historia || []).slice(-HISTORIA_ENVIADA) : [],
      // Rangos que ya ha visto toda la mesa. Es lo mismo que se deduce leyendo el
      // hilo, así que enviarlo no destapa nada; de momento el cliente no lo pinta.
      banderasSueltas: e.banderasSueltas,
      marcador: e.marcador,
      misBajas: miColor ? e.bajas[miColor] : [],
      pendiente: e.pendiente && e.pendiente.color === miColor ? e.pendiente : null,
      piezas: Object.fromEntries(
        Object.entries(e.piezas).map(([id, p]) => [
          id,
          p.color === miColor || terminada
            ? { id, color: p.color, casilla: p.casilla, bandera: p.bandera, rango: p.rango, ultimoTramo: p.ultimoTramo, alternancias: p.alternancias }
            : { id, color: p.color, casilla: p.casilla, bandera: p.bandera, rango: null },
        ])
      ),
    },
  };
}
