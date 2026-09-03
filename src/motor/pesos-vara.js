// LA VARA DE MEDIR, CONGELADA.
//
// Los rivales del panel juegan con ESTOS pesos y no con `PESOS_BASE`. La razón
// es que ya ha pasado tres veces: se toca la heurística para mejorar el bot y
// sin querer se cambia el rival contra el que se mide, así que los números de
// antes y los de después dejan de ser comparables.
//
// La última vez costó una conclusión equivocada. Al añadir la caza de piezas
// reveladas, un modelo registrado al 90% pasó a medir 75% — parecía una
// regresión de 15 puntos y era la vara, que se había endurecido. El modelo nuevo
// medía 78%: mejor que el viejo en igualdad de condiciones.
//
// Esta copia es LITERAL a propósito. No importa `PESOS_BASE` ni lo extiende: si
// lo hiciera, volvería a moverse con cada cambio y no serviría de nada. Cuando
// haga falta actualizarla, se hace a mano y se anota que la serie tiene un corte
// ahí.
//
// Congelada el 2026-09-03, con el bot que caza lo revelado y lleva bien la
// bolsa.
export const PESOS_VARA = Object.freeze({
  ruido: 2,
  coronar: 10000,
  avanceConBandera: 14,
  primaPortador: 6,
  avanceNormal: 3,
  banderaSuelta: 25,
  amenazaBase: 3,
  amenazaFactor: 1,
  cazarRevelado: 6,
  costeDelCanon: -55,
  disparoConocidoBase: 20,
  disparoConocidoFactor: 7,
  disparoDesconocido: 45,
  disparoABandera: 40,
  disparoAlCastillo: 45,
  disparoAlCoronador: 400,
  disparoCercaDelCentro: 14,
  canonEnPosicionDeTiro: 2.5,
  canonConLineaLibre: 2,
  canonSeAcercaATiro: 0.5,
  canonHaciaBlancoEnTorre: 9,
  taparCanonAlAnillo: 40,
  coberturaCompleta: 90,
  ataqueGanaBase: 30,
  ataqueGanaFactor: 6,
  ataqueEmpate: -12,
  ataquePierde: -120,
  espiaAMariscal: 90,
  ataqueDesconocido: 4,
  ataqueABandera: 60,
  portadorNoPelea: -60,
  ataqueAlCastillo: 20,
  amenazaGenerada: 22,
  amenazaCombinada: 70,
  contraAmenaza: 45,
  exponerseACanon: -18,
  salvarAmenazada: 40,
  estorbarEnTorre: -120,
});
