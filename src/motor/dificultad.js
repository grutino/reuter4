// Cómo juegan los bots. Ya no hay niveles: todos juegan a tope.
//
// HUBO CINCO NIVELES y se han retirado a propósito. Graduaban la fuerza con
// ruido -tirar por una candidata peor de vez en cuando- y con memoria, y la
// escalera estaba medida y funcionaba. Pero un bot que falla adrede no es un
// rival más fácil, es un rival que juega a otra cosa, y lo que se quiere aquí es
// el mejor juego que las redes sepan dar.
//
// De todo aquello sobrevive lo único que no era un mando de dificultad sino una
// decisión de fuerza: cuántas candidatas mira la red y cuánto esfuerzo mete en
// el despliegue.
//
// La lección de los niveles, por si alguna vez vuelven: los valores estaban
// MEDIDOS, no elegidos a ojo, y la primera versión los graduó por esfuerzo de
// búsqueda -más candidatas, más recocido- con el resultado de que la escalera
// salió al revés. La fuerza no estaba ahí.

// CUÁNTAS CANDIDATAS MIRA LA RED antes de elegir. Fue 4 durante mucho tiempo,
// con una medida correcta de su época: "4 candidatas 75%, 12 candidatas 74%".
// Pero esa medida se hizo con una red que apenas distinguía entre jugadas, a la
// que darle más opciones solo le daba más formas de equivocarse. El número se
// quedó fijo mientras la red mejoraba. Remedido con la red de ahora:
//
//    4 candidatas   84,2% ±1,3
//    8              88,6%  ·  90,8%   (dos semillas)
//   12              90,3%  ·  90,4%
//   20              88,4%  ·  92,1%
//   40              88,4%
//
// Entre 8 y 20 la diferencia no se distingue del ruido -el orden se invierte al
// cambiar de semilla-, pero el 4 pierde seis puntos en las dos. De ahí el 12,
// que además es el número con el que se entrena y se mide.
//
// La moraleja vale más que el número: un parámetro medido caduca cuando cambia
// aquello sobre lo que se midió.
export const CANDIDATAS_UTILES = 12;

// MIRAR LA RESPUESTA DEL SIGUIENTE antes de mover. Hasta que se añadió, ningún
// bot miraba nada: `aplicar` no aparecía ni una vez en bot.js ni en bot-red.js,
// así que se elegía la mejor jugada según el estado ACTUAL, sin ver el tablero
// resultante ni lo que podía hacer nadie después. Medido en dos semillas
// independientes: 93,4% y 93,2%, contra 90,3% y 90,4% sin ello.
//
// Cuesta x10,8 por turno -de 1,74 ms a 18,82- y el servidor mueve los bots de
// todas las salas en el mismo temporizador. Con partidas sueltas no se nota;
// si algún día hay muchas a la vez, este es el mando que hay que mirar.
export const MIRAR_LA_RESPUESTA = true;

export const COMO_JUEGAN = Object.freeze({
  red: true,
  candidatas: CANDIDATAS_UTILES,
  profundo: MIRAR_LA_RESPUESTA,
  // Recordar los rangos ya revelados en combate. Sin esto el bot vuelve a
  // estrellarse contra el mariscal que ya le enseñó, que era el mando del nivel
  // más bajo de los de antes.
  memoria: true,
  candidatosDespliegue: 12,
  escalada: 60,
  // Sin ruido: cero jugadas tiradas a propósito.
  ruido: 0,
  ruidoSinRed: 0,
});

// Sin modelo publicado los bots caen a la heurística, que sigue jugando bien.
export function configuracionDeBot(hayRed) {
  return hayRed ? COMO_JUEGAN : { ...COMO_JUEGAN, red: false, profundo: false, candidatas: 1 };
}
