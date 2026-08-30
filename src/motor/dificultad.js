// Los cinco niveles de dificultad de un bot.
//
// La dificultad no es un número que multiplique nada: es una combinación de
// cuatro mandos que ya existían sueltos por el motor. Ponerlos juntos aquí evita
// que "nivel 3" signifique una cosa en el servidor y otra en la simulación.
//
//   red        si mira la red o se queda en la heurística
//   candidatas cuántas jugadas evalúa la red antes de elegir
//   ruido      con qué probabilidad tira por una candidata al azar
//   memoria    si recuerda los rangos ya revelados en combate
//   despliegue cuánto esfuerzo mete en montar la posición inicial
//
// Por qué la MEMORIA es el mando del nivel más bajo: es lo que separa al bot
// clásico del actual, y su ausencia se nota jugando de una forma muy humana
// -vuelve a estrellarse contra el mariscal que ya te enseñó-, en vez de parecer
// un bot que juega mal a propósito.
//
// Y por qué hay RUIDO y no solo menos candidatas: un bot que siempre elige la
// mejor de tres candidatas es predecible, y contra un humano eso se aprende en
// diez partidas. El ruido lo hace fallar de vez en cuando sin volverlo tonto.

// LOS VALORES ESTÁN MEDIDOS, NO ELEGIDOS A OJO. La primera versión graduaba los
// niveles altos por esfuerzo de búsqueda -más candidatas, más recocido- y la
// escalera salió al revés: 78%, 75%, 72% para los niveles 3, 4 y 5. Cruzando los
// dos mandos por separado, con ruido cero, quedó claro que ninguno compra fuerza:
//
//    4 candidatas · despliegue 12/60     75%
//   12 candidatas · despliegue 12/60     74%
//    4 candidatas · despliegue 30/200    75%
//   12 candidatas · despliegue 30/200    70%
//
// La ventaja de la red sobre la heurística está en la ordenación gruesa, no en
// afinar entre muchas candidatas. Así que todos los niveles con red miran las
// mismas 4 y despliegan con el mismo esfuerzo: fingir lo contrario sería vender
// un mando que no hace nada, y encima cuesta tiempo de cálculo.
//
// Lo que sí gradúa es el RUIDO, medido contra un rival fijo:
//
//   con red    0,00 -> 75%   0,20 -> 73%   0,35 -> 64%   0,50 -> 54%   0,70 -> 38%
//   sin red    0,00 -> 48%   0,30 -> 45%   0,60 -> 28%
//
// La curva es plana hasta 0,2 y luego cae: elegir entre las seis mejores una de
// cada cinco veces casi no duele, porque las seis son razonables. De ahí salen
// los cinco peldaños, espaciados de verdad.
const CANDIDATAS_UTILES = 4;   // más no aporta, medido arriba
const DESPLIEGUE_UTIL = { candidatosDespliegue: 12, escalada: 60 };

export const NIVELES = {
  1: {
    nombre: "Recluta",
    descripcion: "No recuerda lo que ha visto en combate y se despista mucho.",
    red: false, candidatas: 1, ruido: 0.6, memoria: false,
    candidatosDespliegue: 0, escalada: 0,
  },
  2: {
    nombre: "Veterano",
    descripcion: "Recuerda los rangos revelados, pero juega de heurística y falla a menudo.",
    red: false, candidatas: 1, ruido: 0.35, memoria: true,
    candidatosDespliegue: 0, escalada: 0,
  },
  3: {
    nombre: "Oficial",
    descripcion: "Usa la red entrenada y despliega con ella, aunque se equivoca la mitad de las veces.",
    red: true, candidatas: CANDIDATAS_UTILES, ruido: 0.5, memoria: true, ruidoSinRed: 0.2, ...DESPLIEGUE_UTIL,
  },
  4: {
    nombre: "Coronel",
    descripcion: "La red entrenada con pocos despistes.",
    red: true, candidatas: CANDIDATAS_UTILES, ruido: 0.28, memoria: true, ruidoSinRed: 0.08, ...DESPLIEGUE_UTIL,
  },
  5: {
    nombre: "Mariscal",
    descripcion: "Todo lo que sabe, sin un solo fallo deliberado.",
    red: true, candidatas: CANDIDATAS_UTILES, ruido: 0, memoria: true, ruidoSinRed: 0, ...DESPLIEGUE_UTIL,
  },
};

// SIN MODELO PUBLICADO, los niveles altos caen a la heurística, y entonces sus
// ruidos dejan de tener sentido: el nivel 3 lleva 0,5 porque compensa la ventaja
// de la red, así que sin red quedaría por DEBAJO del nivel 2, que lleva 0,35. La
// escalera se invertía justo en el tramo del medio.
//
// Pasa de verdad y no es una hipótesis: al cambiar los rasgos, los modelos
// publicados quedan rechazados hasta que se reentrena y se vuelve a publicar, y
// mientras tanto los cuatro bots juegan de heurística.
//
// Así que cada nivel con red trae también el ruido que le toca cuando no la hay,
// escalonado sobre la curva medida de la heurística sola (0,00 -> 48%,
// 0,30 -> 45%, 0,60 -> 28% contra el nivel 2).
export function configuracionDeNivel(nivel, hayRed) {
  const cfg = NIVELES[nivelValido(nivel)];
  if (cfg.red && !hayRed && cfg.ruidoSinRed !== undefined) {
    return { ...cfg, red: false, ruido: cfg.ruidoSinRed };
  }
  return cfg;
}

export const NIVEL_POR_DEFECTO = 4;

export function nivelValido(n) {
  const k = Number(n);
  return Number.isInteger(k) && k >= 1 && k <= 5 ? k : NIVEL_POR_DEFECTO;
}

// Lo que el cliente necesita para pintar el selector, sin exponer los mandos.
export const ESCALA = Object.entries(NIVELES).map(([n, v]) => ({
  nivel: Number(n), nombre: v.nombre, descripcion: v.descripcion,
}));
