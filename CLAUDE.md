# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Idioma

Todo el proyecto está en español: identificadores, comentarios, mensajes del protocolo,
nombres de eventos y textos de las pruebas. Mantén esa convención al añadir código.
Nombres de casillas y colores (`rojo`, `verde`, `azul`, `amarillo`) son claves reales del
estado, no cadenas de presentación: no las traduzcas.

## Comandos

```bash
npm install
npm test               # pruebas del motor; sale con código 1 si falla alguna
npm run simular        # salud de los bots + duelo entre el bot con memoria y el clásico

# Entrenar
npm run destilar       # mete el orden de la heurística en la red, sin jugar partidas
npm run coevolucion    # bucle red contra red + genético de formaciones
npm run nocturno       # sesiones encadenadas hasta que deje de mejorar; deja diagnóstico
npm run escenarios     # llena el banco de posiciones decisivas y las etiqueta jugando
npm run juzgar         # sala de juicios: marcar candidatas buena/mala/indefinida
npm run publicar-redes # lleva los modelos entrenados a los que usan los bots

# Mirar
npm run informe-redes  # rehace la página de seguimiento desde los modelos guardados
npm run mirar          # sirve esa página en el 8099
npm run panel          # mide los modelos contra el panel, rival a rival
npm run analizar       # qué jugadas decidieron una partida

# Jugar
npm run build          # compila el cliente a dist/
npm run servidor       # servidor en el 8080 (sirve dist/ y el WebSocket)
npm run dev            # cliente Vite en el 5173, con /ws redirigido al 8080
npm start              # build + servidor, producción en un solo proceso
```

**El evolutivo de pesos se retiró.** `entrenar-pesos.mjs`, `genoma.mjs`, `revisar-pesos.mjs`,
`interpretar.mjs` y el informe viejo ya no existen: sus resultados no se cargaban en ninguna
parte —`PESOS_BASE` está escrito y ajustado a mano— y la red los sustituyó. La lección que
dejaron sigue abajo, en «Cómo comparar dos genomas sin engañarse», porque vale igual para
comparar dos redes.

En desarrollo hacen falta dos terminales: `npm run servidor` y `npm run dev`.

`simular` acepta dos argumentos, partidas de salud y partidas de duelo:
`node src/motor/simulacion.js 0 2000` mide solo el duelo, con muestra grande. El duelo alterna
los bandos partida sí, partida no, porque el tablero no es simétrico.

Variables: `PORT` (8080) y `R4_ESTADO` (fichero de salas, `servidor/salas.json`).

**Ejecutar una sola prueba**: no hay filtro por nombre. `pruebas.js` es un guion plano que
invoca `prueba(nombre, fn)` de arriba abajo. Para aislar una, comenta las demás o extrae el
escenario a un `node -e`. Si añades un filtro, hazlo en la función `prueba`.

## Entrenamiento de los bots (`entrenamiento/`)

Vive fuera de `src/` y el servidor no importa nada de ahí. Produce artefactos que el juego
consume, no código que el juego ejecute.

```
arena.mjs              una partida, un enfrentamiento; todo el azar sale de una semilla
paralelo.mjs           piscina de obreros persistente + trocear/sumar combates largos
obrero.mjs             un hilo que juega lo que le mandan
red.mjs                retropropagación con Adam y pérdida por pares; reexporta la inferencia

destilar.mjs           mete el orden de la heurística en la red, sin jugar partidas
entrenar-despliegue.mjs  la red que monta la posición inicial
entrenar-jugada.mjs    la red que elige jugada
coevolucion.mjs        el bucle: las dos redes contra el genético de formaciones
formaciones.mjs        población de despliegues que evoluciona para ganarle a las redes
nocturno.mjs           sesiones encadenadas hasta que deje de mejorar; deja diagnóstico

aperturas.mjs          el formato de rejilla 3x7 y sus variaciones
panel.mjs              la vara: 38 rivales fijos
medir-panel.mjs        mide los modelos contra el panel, rival a rival
sensibilidad.mjs       qué mira cada red; una función por red

escenarios.mjs         banco de posiciones decisivas
construir-escenarios.mjs  lo llena y lo etiqueta jugando
analizar-partida.mjs   qué jugadas decidieron una partida

informe-redes.mjs      la página de seguimiento; se escribe en docs/
mirar.mjs              la sirve en el 8099
modelos/               artefactos generados; el TALLER, no lo que juega
```

**Cuatro cosas se descubrieron midiendo y no conviene volver a romperlas:**

1. **Semilla y números aleatorios comunes.** Cada emparejamiento se juega dos veces con la
   misma semilla y los bandos cambiados. Sin eso, el ruido del despliegue tapa cualquier
   diferencia entre configuraciones.
2. **La medición contra la heurística a mano usa semillas FIJAS** (`SEMILLA_MEDIDA`). Con
   semillas variables la curva saltaba del 47% al 28% con el mismo modelo: era todo ruido.
3. **Tope de turnos.** Dos configuraciones malas no rematan la partida jamás: se van a los
   4000 turnos. Con tope de 400, el entrenamiento va ocho veces más rápido.
4. **Recompensa moldeada.** Y lo más importante: dos bots al azar dan *ocho tablas de ocho*.
   Con solo victoria/derrota la fase de arranque a ciegas no tiene gradiente ninguno. Por eso
   `repartoDeTablas` reparte las tablas según quién estaba más cerca de ganar —distancia de la
   bandera al castillo, material y marcador—, y la aptitud usa `puntuacionA`, no `tasaA`.

También se probó y se descartó: medir la aptitud solo contra el campeón vigente (la población
se deteriora, porque ganar a un campeón malo no te hace bueno) y quedarse con el mejor de cada
generación (con partidas tan ruidosas, el mejor lo es a menudo por suerte).

### Cómo comparar dos genomas sin engañarse

Esto costó cuatro conclusiones contradictorias, así que conviene leerlo antes de tocar el
genoma:

- **Un entrenamiento por configuración no vale.** Con el mismo genoma y distinta semilla, los
  modelos salen entre el 19% y el 56% contra la misma referencia. La dispersión *dentro* de un
  genoma (37 puntos) es diez veces el efecto que se quiere medir *entre* genomas (3 puntos).
  Hacen falta varias semillas y compararlas en agregado.
- **Hay no transitividad.** Un modelo puede ganar a otro en el cara a cara y perder contra él
  midiendo los dos contra un tercero. Pasó con la semilla 33: el de 26 genes marca 19% contra
  la heurística y el de 20 marca 52%, y sin embargo el de 26 le gana 56% cuando juegan entre
  ellos. En juegos de información imperfecta esto es normal, no un error de medida: no existe
  un único número que ordene la fuerza.
- **La consecuencia práctica**: medir contra un PANEL de rivales (la heurística más varios
  modelos guardados) y ordenar por media, en vez de contra un único adversario.
- **La vara de medir tiene que ser inmutable.** Añadir pesos nuevos a `PESOS_BASE` cambió sin
  querer la referencia contra la que mide el entrenamiento, y la curva subía en parte porque el
  rival había empeorado. Hay que congelar una copia literal.

`coronar` no se entrena: llevar la bandera a la torre es ganar, no una preferencia que
convenga graduar. Las `ESCALAS` dicen en qué unidades vive cada peso, no qué valor es bueno.

### Las redes en el juego (`src/motor/red.js`, `bot-red.js`, `modelos/`)

La inferencia vive en el motor porque **el juego la ejecuta**: un bot que decide con
la red tiene que evaluarla mientras se juega. Lo que se queda fuera es lo que solo sirve
para aprender.

```
src/motor/red.js         paso adelante y serialización
src/motor/rasgos-*.js    los tres extractores de rasgos
src/motor/bot-red.js     accionConRed, despliegueGuiado, cargarModelos
src/motor/modelos/       los modelos QUE JUEGAN
entrenamiento/red.mjs    retropropagación con Adam; reexporta lo de arriba
entrenamiento/modelos/   el taller: aquí escribe el entrenamiento
```

**Dos carpetas de modelos, y la separación es deliberada.** Entrenar sobrescribe
`entrenamiento/modelos/` continuamente —una prueba de humo de 120 partidas ya pisó dos veces
un modelo de 4000—, así que los modelos que juegan viven aparte y solo se sustituyen a mano
con `npm run publicar-redes`. Un proceso nocturno desatendido no debería cambiar cómo juegan
las partidas reales.

`cargarModelos` rechaza un modelo cuyo número de entradas no coincida con los rasgos de esta
versión. No es decorativo: al añadir rasgos, un modelo viejo se carga sin dar **ningún error**
y juega con basura. Si no hay modelo, o está obsoleto, los bots juegan con la heurística y el
servidor lo dice al arrancar.

**La regla de información oculta vale también para la red.** El servidor mueve con
`accionConRed`, que es otro camino que `accionDeBot`, y la prueba que vigilaba las fugas no lo
cubría. Ahora hay una que compara los RASGOS entre dos escenarios que solo difieren en el rango
escondido: si el vector de entrada es idéntico, ninguna red posible puede distinguirlos. Es más
fuerte que comparar decisiones, que depende de los pesos que tenga la red ese día.

### Los cañones y el castillo

Tres cosas que conviene tener claras antes de tocar nada de esto:

- **Cómo se ataca la torre.** Cuerpo a cuerpo, desde el anillo, y eso ya sale solo porque
  `ADYACENTES[ANILLO]` incluye `TORRE`. Con cañón, desde las **doce** casillas que rodean el
  castillo (`BATEN_LA_TORRE`), que es **adyacencia y no línea de tiro**: G6 está pegada al
  castillo pero su recta hacia el sur solo encuentra G7, G8 y G9, que son celdas del anillo,
  nunca la torre. La bala pasa por encima del anillo, así que da igual quién lo ocupe. Por eso
  el motor genera este tiro aparte de `rayo`, que corta al llegar al castillo y no devuelve
  `TORRE` nunca. Un cañón metido en el anillo no puede atacar la torre: no está en las doce y
  tampoco combate cuerpo a cuerpo.
- **Batir el castillo no es solo parar coronaciones.** `disparoAlCastillo` se suma por estar el
  objetivo en el anillo o la torre, lleve bandera o no: un mariscal conocido plantado en el
  anillo puntúa 130 frente a 66 de un capitán en campo abierto. `disparoAlCoronador` es un extra
  aparte, para quien puede ganar en su turno.
- **Tapar el tiro vale para los dos del equipo.** Una bandera solo la corona una pieza de su
  propio color, así que el equipo gana por dos vías —yo con la mía o el compañero con la suya— y
  las dos piden lo mismo. La primera versión miraba solo `socio.aPuntoDeCoronar` y dejaba fuera
  la mitad de los casos, justo los que uno juega en primera persona; ahora manda
  `equipoAPuntoDeCoronar`. `socio.aPuntoDeCoronar` sigue existiendo aparte porque "no estorbar
  en la torre" sí es cosa del compañero: uno no se estorba a sí mismo. Tapa cualquier pieza que
  llegue con su movimiento —un explorador cruza el tablero de una sentada— menos un cañón, que
  no combate cuerpo a cuerpo y plantarlo ahí es regalarlo.
- **UN CAÑÓN NO SE CONOCE NUNCA, SE SOSPECHA.** No sobrevive a un duelo —rango 1, pierde contra
  todo— y no se delata al moverse, porque anda una casilla por turno. Medido: **0 cañones
  revelados en 7.335 turnos**. Cualquier código que dependa de `rangosRevelados[id] === CANON`
  es código muerto; la rama existe en `analisis.js` como red de seguridad, pero no se ejecuta.
- **Y la sospecha hay que llevarla contando la bolsa.** Mirar solo `rangosRevelados` daba
  "quedan 2 de 2" toda la partida, incluso después de que el rival gastara los dos. Ahora el
  motor lleva dos registros públicos nuevos: `caidosPublicos[color]`, los rangos que han caído
  —toda muerte publica el rango, en el duelo o en el cañonazo—, y `reclutas[color]`, cuántas
  veces ha reclutado cada bando. Con eso, gastados los dos cañones y sin reclutar, la sospecha
  es **cero** y subir al anillo es seguro.

  **`caidosPublicos` no es `bajas`, y la diferencia importa.** `bajas` es la bolsa de
  reclutamiento y `reclutar` SACA de ella el rango recuperado, así que leerla para otro color
  sería saber *qué* pieza ha vuelto — y eso no es público: el evento de reclutamiento publica el
  color y nada más. `caidosPublicos` solo apunta y nunca quita, y por eso un recluta devuelve
  solo la *posibilidad* de cañón, como mucho tantas veces como cañones hayan caído.
- **Tapar una línea no es cubrir el anillo.** El rival mueve el cañón de lado y vuelve a
  apuntar, así que lo que decide es cuántas líneas quedan abiertas después de la jugada
  (`lineasAbiertasSi`) y si hay presencia suficiente para tapar las que abran
  (`analisis.presencia`). Por eso `coberturaCompleta` premia rematar la cobertura y no
  empezarla. Medido, hoy ese peso es casi inerte: con la sospecha bien contada suele haber
  varias líneas abiertas y llegar a cero es raro.
- **Y hay que saber cuáles de estos rasgos son demasiado raros para aprenderse.** Medido sobre
  3.420 vectores de jugada de 25 partidas:

  ```
  presenciaEnElCentro       31 valores distintos   media 0,478
  anilloCubiertoTrasJugar    4 valores             media 0,744
  canonHaciaElTiro           3 valores             media 0,019
  cubroLaUltimaLinea         2 valores             media 0,002
  tapaLineaAlAnillo          2 valores             media 0,001
  disparoAlCoronador         1 valor               media 0,000
  ```

  Los tres últimos casi no ocurren, y un rasgo que se activa en el 0,2% de los ejemplos no
  aporta gradiente: la red lo ignorará. No es el caso de `juntoALago` —aquellos eran
  imposibles por geometría, estos son posibles y decisivos cuando pasan— pero sí quiere decir
  que **la heurística es quien los cubre de verdad**, con pesos deterministas como
  `disparoAlCoronador: 400`, y que para que la red los aprenda haría falta sobremuestrear
  posiciones cerca del castillo.
- **El tiro a la torre es legal pero los bots no lo ejecutan nunca.** Medido: en 17.213 turnos,
  un jugador tuvo un cañón en una de las doce casillas solo 2 veces, y ninguna con la torre
  ocupada, aunque la torre lo está el 12,8% de los turnos. Es geometría: ninguna casilla de
  despliegue está a menos de **tres** pasos de las doce (están a 3, 4 o 5), y un cañón es rango
  1, mueve una casilla por turno y pierde todo cuerpo a cuerpo. Batir el anillo sí es
  alcanzable —hay casillas de despliegue a un solo paso de una posición de tiro al anillo—;
  batir la torre exige sobrevivir un paseo por la zona más disputada. Subir el peso general de
  posicionamiento NO es la salida: eso ya costó bajar del 52% al 37%. La vía realista es que la
  red de despliegue aprenda a nacer cerca y la de jugada aprenda el momento.
- **Ojo con el modelo del castillo al leer las reglas.** Sobre el tablero de verdad el anillo
  son ocho celdas (G7 H7 I7 G8 I8 G9 H9 I9) y la torre es H8; aquí el anillo es UNA
  pseudocasilla. Una regla enunciada como "desde estas ocho casillas" se traduce a "desde
  `ANILLO`".
- **Una bandera solo la corona una pieza de su propio color.** Subir a la torre con la bandera
  de otro color no termina la partida: te quedas ahí ocupando el sitio. Lo del equipo es aparte
  y no cambia — cuando el compañero corona SU bandera, ganan los dos.
- **La regla de coronación vive en un solo sitio**, `banderaQueCorona`. Los bots necesitan
  saber quién está a un movimiento de ganar, y si duplicaran la regla, cambiarla en el motor
  dejaría a los bots prediciendo un juego distinto del que se juega.
- **El problema de los cañones nunca fue la valoración del disparo.** Medido: cuando el tiro al
  anillo es legal, el bot lo toma el 98% de las veces. Lo que pasaba es que solo era legal en el
  1% de los turnos en que había un rival ahí, porque un cañón mueve una casilla por turno y de
  media empieza a 6,6 pasos del castillo.

Y la lección de los pesos de posicionamiento, que es contraintuitiva: **empujar fuerte al cañón
hacia su posición de tiro hace PERDER**. Con 24/20/5 el bot bajó al 37% contra el de antes. No
era que los cañones murieran —mueren en duelo el 1% de las veces, con y sin los pesos— sino
tempo: cada turno que un cañón camina es un turno que nadie usa para avanzar banderas, y en una
carrera a cuatro eso se paga. Escalando los tres pesos a la vez, contra el bot anterior:

```
x1,00 -> 36%     x0,25 -> 51%     x0,12 -> 59%     x0,06 -> 62%     apagado -> 52%
```

Con los valores pequeños que quedaron, cinco juegos de semillas frescos dan 53/52/58/61/54, o
sea 55,6% de media. Y **no se pueden poner a cero**: la red solo ordena las candidatas que le
pasa la heurística, así que con peso cero la jugada no asoma nunca y la red no puede aprender
cuándo conviene. Ese es el equilibrio que hay que respetar al añadir cualquier táctica nueva —
el peso tiene que ser bastante para que la jugada aparezca entre las candidatas y poco para no
imponer la decisión.

### Quién decide la jugada, y por qué la heurística sigue ahí

Hay dos caminos y conviene no confundirlos:

```
accionConRed     la heurística puntúa TODAS las legales, se queda con 4, la red las ordena
jugadaSoloRed    la red puntúa las 28 legales de media, sin heurística delante
```

El segundo sale **más barato**, contra toda intuición: medido, la heurística cuesta 0,42 ms por
turno y los rasgos de una jugada 0,006, así que puntuarlas todas son 0,59 ms frente a los 0,87
de pasar antes por la heurística. El cuello de botella es el análisis del turno, que se hace una
vez en los dos casos.

Pero **una red entrenada por un camino no sirve por el otro**. La red entrenada con las cuatro
finalistas de la heurística, obligada a puntuarlas todas, sacó **0 victorias de 72**: nunca había
visto las otras veinticuatro. Por eso existe `npm run destilar`, que le enseña directamente el
orden que la heurística ya sabe, con una **pérdida por pares** que no necesita jugar ninguna
partida. De 0% pasó a jugar al nivel de la heurística, y desde ahí la coevolución con
`--soloRed 1` la lleva por encima.

Tres cosas que costó descubrir al destilar:

- **El logit no se recupera invirtiendo la sigmoide.** Con la salida saturada las dos jugadas
  valen 1,0000 y el recorte se come la diferencia: la primera versión aprendía el orden
  INVERTIDO, 18% de aciertos. `adelante` cuelga ahora el logit del array de activaciones.
- **Hay que mezclar las dos pérdidas.** La de pares solo mira diferencias y dispara la escala;
  sin ejemplos de valor la salida deja de ser una probabilidad.
- **El filtro de pares importa más que nada.** Solo con parejas de margen amplio: 98,5% de pares
  acertados y apenas 57% de acierto en la jugada que se elige. Solo con parejas ancladas al
  mejor: el puesto medio de su elección se fue de 1,7 a 7,5. Hacen falta las dos cosas.

**La heurística sale del camino de decisión pero se queda de andamio.** Una red recién
inicializada jugando contra sí misma da las ocho tablas de ocho de siempre, y además el bucle
sigue metiendo pares suyos cada ronda (`--anclaPares`) para que la red no olvide el orden
mientras persigue resultados. Medido: con el modelo actual los dos caminos empatan a 65%, o sea
que la heurística ya no aporta nada a la decisión — solo al arranque y a la medida.

### Medir sin engañarse (lo que ha costado tres veces)

`medirContraPanel` es determinista: misma semilla, mismas partidas. De ahí salen tres errores
que ya se han cometido y no conviene repetir:

1. **El máximo de una tanda de medidas ruidosas está sesgado al alza.** Un 73% se anunció como
   84% por quedarse con la mejor de ocho rondas medidas en las mismas partidas.
2. **Un titular no puede conservar la nota con la que fue elegido.** Fue elegido justamente por
   tener suerte en esas partidas; los aspirantes traen notas honestas y el listón se vuelve
   inalcanzable. Doce rondas seguidas descartadas. Ahora el titular revalida cada ronda en las
   mismas partidas que el aspirante.
3. **Lo mismo una capa más arriba**: si todas las sesiones de una noche se miden en las mismas
   partidas, quedarse con la mejor sesión es el mismo sesgo. Cada sesión mide con
   `--veredictoBase` distinto y al final se confirma en partidas vírgenes.

Y la distinción que sostiene todo lo demás: **el PANEL es la vara y no se mueve** (38 rivales,
semilla 2024); **la LIGA es el gimnasio** y se endurece a propósito. Las formaciones duras van a
`aperturas/duras/` y NO a `aperturas/campeonas/`, que sí la carga `construirPanel`.

## Arquitectura

Tres capas con dependencias en una sola dirección: el motor no conoce ni al servidor ni al
cliente, y esa separación es lo que permite probar las reglas sin levantar nada.

```
src/motor/    reglas puras: estado y transiciones, sin E/S ni gráficos
src/motor/bot.js  heurística de los bots, compartida por servidor y simulación
src/siluetas.js   pinta las siluetas de rango; los datos vienen de siluetas-datos.js
src/siluetas-datos.js  GENERADO por herramientas/extraer-siluetas.py; no editar a mano
src/ficha.js      pinta una ficha (disco + silueta); lo comparten el 3D y la ventana de combate
servidor/     autoridad: guarda el estado completo, reparte vistas recortadas, mueve bots
src/          cliente React; Tablero3D.jsx pinta con three.js
```

### El motor (`src/motor/`)

`tablero.js` es geometría pura y se calcula una sola vez al cargar el módulo: `CASILLAS`,
`ADYACENTES`, `ACCESOS_CASTILLO` son constantes derivadas, no funciones. La rejilla nominal es
15x15 pero solo 165 casillas están en juego; el resto es bosque, lago o la huella del castillo.

El castillo merece atención: físicamente ocupa 3x3 (`CASTILLO_HUELLA`), pero lógicamente son
**dos pseudocasillas**, `ANILLO` y `TORRE`, que viven en `CASILLAS` y `ADYACENTES` junto a las
casillas normales. Cualquier código que recorra el tablero debe tolerar que una "casilla" no
tenga coordenadas parseables. `rayo()` corta al llegar al castillo y lo devuelve como `ANILLO`.

`motor.js` expone el ciclo `nuevaPartida → movimientosLegales → aplicar`. `aplicar` valida la
acción contra la lista legal, **clona el estado y devuelve uno nuevo**: nunca muta el que
recibe. `reclutar` y `renunciarAlReclutamiento` hacen lo mismo.

**Invariante crítica**: el estado debe ser serializable a JSON puro. `clonar()` usa
`JSON.parse(JSON.stringify(...))` y el servidor lo vuelca a disco. Nada de `Map`, `Set`,
`Date` ni funciones dentro de `estado`.

Reglas que no se deducen leyendo un solo fichero:

- **Alcance por rango**: explorador (3) recorre la recta entera, capitán (6) llega a dos
  casillas con giro, el cañón (1) no combate cuerpo a cuerpo pero dispara hasta 3 y la bala
  sobrevuela lagos. Quien lleva bandera queda reducido a una casilla, sea cual sea su rango.
- **Duelos**: el espía (2) gana al mariscal (9) solo si es él quien ataca. Empate de rangos
  iguales retira a los dos.
- **Banderas**: `estado.banderas[color]` tiene `{portador, casilla, ultimoDueño}` y
  `estado.banderasSueltas` es un mapa `casilla → color` de las que están en el suelo. El campo
  `ultimoDueño` es el que decide si capturar una bandera da promoción: solo la da si venía de
  su dueño original. Un portador que cae suelta su bandera donde muere, y **recogerla es una
  decisión**: caer sobre una bandera suelta abre un `pendiente` de tipo `recoger`, con dos
  salidas, `recogerLaBandera` y `renunciarARecoger`. Lo que cuelga de recoger —la promoción y
  la victoria al coronar— vive en la resolución, no en `aplicar`.
- **Reclutamiento**: se abre por 6 victorias (que reinician el marcador) o por capturar una
  bandera enemiga (que no lo toca). Mientras `estado.pendiente` esté puesto, `aplicar` lanza:
  hay que resolverlo antes de seguir.
- **Cola de decisiones**: una jugada puede abrir dos a la vez (recoger y reclutar).
  `estado.pendiente` es la que toca ahora y `estado.colaPendientes` guarda el resto; la
  recogida se ofrece siempre antes. Quien resuelve una pone `pendiente` a null y llama a
  `cerrarPendiente`, que saca la siguiente o pasa turno. Se mantiene la regla vieja: una
  jugada abre como mucho **un** reclutamiento.
- **Equipos**: siempre 2 contra 2, fijos, según `SOCIO` y `EQUIPOS`. Ni siquiera el compañero
  ve tus rangos. Corona cualquiera de las dos banderas del equipo y ganan los dos.
- **Turnos**: `pasarTurno` salta a quien no tenga movimientos legales; si no los tiene nadie,
  la partida acaba en tablas.
- **Vaivén**: `MAX_ALTERNANCIAS` corta la repetición entre las mismas dos casillas.

### El servidor (`servidor/servidor.mjs`)

Es la autoridad: guarda el estado completo y a cada cliente le manda solo lo suyo. La función
que recorta es `salaParaJugador`, que pone `rango: null` en las piezas ajenas.

**Ojo con la duplicación**: `salaParaJugador` reimplementa lo que `vistaDe` hace en `motor.js`.
Son dos censuras paralelas. Si añades un campo con información oculta a `estado.piezas`, hay
que recortarlo en los dos sitios o se filtra por el WebSocket.

El bot vive en un solo sitio, `src/motor/bot.js`, y de ahí lo importan el servidor y la
simulación. `accionDeBotClasico` es la versión antigua sin memoria y se conserva **solo** como
vara de medir en el duelo de `npm run simular`: no la "mejores", porque deja de ser referencia.

Los bots corren en un `setInterval` de 1200 ms que recorre todas las salas: rellena despliegues
que falten, arranca la partida cuando están los cuatro y mueve al que le toque. Un humano
desconectado más de 60 s pasa a jugar automático (`esAutomatico`), y al reconectar recupera su
puesto porque el identificador vive en `localStorage` del cliente.

El estado se persiste con un *debounce* de 1500 ms a `R4_ESTADO`, y las salas sin actividad se
borran a las 12 horas.

### Memoria de los bots e hilo de historia

El motor mantiene dos registros públicos, ambos JSON puro y ambos creados al vuelo si faltan
(`asegurarRegistros`), porque los escenarios de prueba y las salas guardadas por versiones
anteriores no los traen:

- `estado.rangosRevelados`: mapa `idPieza → rango` con lo que ha quedado a la vista de la mesa.
  Entra ahí quien sobrevive a un duelo, y quien se delata al moverse (más de una casilla en
  línea solo lo hace el explorador; dos con giro, solo el capitán). Al retirar una pieza se
  borra su entrada.
- `estado.historia`: una entrada por jugada, con `n` correlativo, la jugada y los eventos que
  produjo. Se recorta por arriba a `MAX_HISTORIA`, y la numeración sale de la última entrada,
  no de la longitud, justo para sobrevivir al recorte.

**La regla que no se puede romper**: los bots corren en el servidor con el estado completo
delante, pero solo pueden leer `rangosRevelados`. Nunca `estado.piezas[id].rango` de una pieza
ajena. Hay una prueba que lo vigila ("los bots solo miran la memoria pública"): monta dos
escenarios idénticos salvo el rango escondido del defensor y exige que el bot juegue igual.

El servidor manda la cola del hilo (`HISTORIA_ENVIADA`) y solo a quien ocupa un puesto, porque
`repartir()` reenvía todas las salas a todos los clientes en cada cambio.

**`rangosRevelados` no sale del servidor.** Es memoria de los bots y nada más. Sobre el tablero
solo se marcan los rangos propios; los ajenos van tapados siempre, incluso después de haberse
visto en un combate. Lo que el jugador humano ve es la **ventana de combate**: un modal que
salta solo al haber un duelo o un cañonazo, enseña las dos piezas con su rango y se queda hasta
que se cierra. A partir de ahí, recordarlo es cosa suya, igual que en la mesa de verdad. Si
alguna vez se vuelve a mandar `rangosRevelados` al cliente, se rompe justo esa simetría entre
lo que sabe el bot y lo que le cuesta saber al humano.

El cliente saca los combates del propio hilo (`combatesDeEntrada`), no de `eventos`: así no se
pierde ninguno si llegan dos cambios seguidos. Al entrar en una sala se marca como visto todo
lo ya jugado, para no soltar de golpe los combates de hace veinte turnos al reconectar.

### Informe de fin de partida

Al terminar —y **solo** al terminar— el servidor deja de censurar: manda los rangos de los
cuatro ejércitos, el hilo completo y los despliegues iniciales. La condición mira `estado.fin`
y no `sala.fase`, porque la fase puede quedarse en `"fin"` por otros caminos y lo que importa
es que la partida ya no pueda continuar.

El tablero 3D se destapa solo, sin tocar nada: ya pintaba `pieza.rango` cuando venía.

`src/informe-partida.js` arma un documento imprimible que se abre en una pestaña nueva; el
PDF lo hace el propio diálogo del navegador, que evita meter una biblioteca de PDF por algo
que el sistema ya sabe hacer. Lleva los cuatro despliegues iniciales, un diagrama de flechas
por bando —la opacidad crece con el turno, así que se lee como una secuencia y no como una
maraña— y el hilo completo con sus combates.

El fondo del tablero se define **una vez** como `<symbol>` y los ocho diagramas lo referencian
con `<use>`: son 225 rectángulos por diagrama y el documento pasaba de 258 KB a 66 KB.

Las piezas se dibujan con `pintarFicha`, **la misma** que genera la textura del tablero 3D y la
de la ventana de combate: el informe no imita el aspecto del juego, usa el mismo dibujo con su
silueta y su contorno interior grabado. Necesita canvas, así que solo salen en el navegador;
generado desde una prueba cae al número dentro de un disco. Las 36 fichas (9 rangos x 4
colores) van una sola vez en `<defs>` como `<symbol>` y se referencian con `<use>`, también en
el hilo.

**Dos cosas hacen posible reproducir una partida, y las dos costaron un fallo.** El rango de un
reclutamiento **sí** se guarda en el hilo, tapado hasta el final por `historiaPublica`: sin él
el replay pierde al recluta y todo lo que haga después. Y `MAX_HISTORIA` subió de 200 a 1200
porque el hilo no es solo para leerlo mientras se juega — con 200, una partida de 221 turnos
perdía el principio y el replay hacía aparecer piezas de la nada. Lo que se manda a los clientes
sigue acotado aparte con `HISTORIA_ENVIADA`. Si aun así el hilo llega recortado,
`reconstruirRangos` lo detecta (`historia[0].n > 1`) y devuelve nulos en vez de rangos
inventados.

**El hilo dice de qué rango era cada jugada, y eso hay que reconstruirlo.** El registro guarda
color, tipo, origen y destino pero no el rango de quien mueve, porque mientras se juega es
información oculta. `reconstruirRangos` parte del despliegue inicial y aplica el hilo entero, y
desde que el rango del recluta se guarda tapado, identifica **todas** las jugadas. La reconstrucción
trae su propia vara de medir: los duelos **sí** publican los dos rangos, así que si el replay no
coincide con lo que dice el duelo, el replay está mal — y hay una prueba que lo exige sobre
cuatro partidas.

**Ojo con `coord`, que usa una convención mixta**: devuelve la columna en base 0 y la fila en
base 1, así que `coord("A1")` es `[0, 1]`. Tratar las dos igual desplaza las columnas —y solo
las columnas— una casilla a la izquierda. Pasó aquí, y no lo cazó ninguna prueba porque el
fondo salía bien: construye los nombres desde un contador base 1, y lo que se descuadraba era
todo lo que iba encima. Hay una prueba que ahora exige que el centro de cada casilla caiga
dentro del cuadro que el fondo dibuja para ese mismo nombre.

**La censura del servidor vive ahora en `servidor/vista.mjs`.** Estaba dentro de
`servidor.mjs`, que abre el puerto al importarse, así que la función que no puede fallar era la
única sin prueba. Siguen siendo dos censuras paralelas —esta y `vistaDe`—, pero ahora las dos
tienen prueba.

### Parar y borrar

`parar` cierra la partida dejando la sala en pie (para repasar el hilo); `borrar` la elimina
para todos. Las dos exigen `sala.anfitrion === sesion.id`, igual que `bot`, `librar` y
`empezar`.

### Protocolo WebSocket

Cliente → servidor: `hola`, `crear`, `unirse`, `bot`, `librar`, `empezar`, `despliegue`,
`accion`, `reclutar`, `recoger`, `parar`, `borrar`, `salir`. Servidor → cliente: `identidad`, `salas`, `error`.

No hay mensajes diferenciales: cada cambio dispara `repartir()`, que reenvía a cada sesión el
mapa completo de salas ya recortado. Es derrochador pero simple, y evita que el cliente pueda
desincronizarse.

`bot`, `librar`, `empezar`, `parar` y `borrar` exigen ser el anfitrión (`sala.anfitrion`).

### La cámara de cada jugador, y hacia dónde miran las fichas

`colorCamara` sitúa la órbita con `x = radio·sin(theta)` y `z = radio·cos(theta)`, así que
`theta = +PI/2` la pone en **+x** —el este, donde está el verde— y `-PI/2` en **-x**, el oeste
del amarillo. La tabla los tenía **cambiados**: un jugador verde miraba el tablero desde el lado
del amarillo y veía su propio ejército al fondo. Estuvo así hasta que se fue a comprobar la
rotación de las fichas.

Y las fichas giran según **el ejército al que pertenecen** (`GIRO_DE_FICHA`), no según quién
mire: cada una tiene la cabeza hacia el centro desde su lado, que es como están sobre la mesa.
Antes salían todas mirando al sur.

### Las alturas sobre la baldosa

`posicion3D` devuelve **y = 0,1** para una casilla normal, y la baldosa es una caja de 0,1 de
alto centrada medio grosor por debajo: su cara superior está justo en 0,10. Todo lo que se pinte
encima —el número del contador, la quemadura de un cañonazo— tiene que ir por arriba de eso.
Puestos a 0,055 quedaban **dentro** de la baldosa y no se veían; las llamas sí, porque iban a
0,2. Es un fallo silencioso: no da error, simplemente no aparece nada.

### El galón de la ficha

A 46 px —el tamaño real en el tablero 3D— las siluetas se vuelven manchas parecidas. Medida la
distancia entre las nueve fichas, las dos más confundibles eran **explorador y general**, que
están en extremos opuestos de la escala: confundir un 3 con un 8 cuesta mucho más que confundir
un 5 con un 6, y sin embargo era la confusión más probable.

Por eso la ficha lleva un arco en el borde cuya longitud crece con el rango. No sustituye a la
silueta: la silueta dice **quién** es la pieza y el arco **cuánto pesa**. Con él, la distancia
visual entre dos fichas correlaciona **0,85** con su distancia de rango, o sea que las
confusiones caras pasan a ser las más difíciles, y aguanta hasta 24 px. Las peores parejas son
ahora 2-3, 5-6 y 7-9, todas adyacentes.

`pintarFichaTapada` no lo lleva, claro: una pieza enemiga no enseña su rango.

### El aspecto de la escena 3D

Todas las texturas son **procedurales**: se pintan en un canvas al arrancar y se cachean, en
`src/texturas.js`. Ni un fichero de imagen, por la misma razón que las siluetas —el proyecto no
arrastra descargas— y además cada material se ajusta con números.

```
madera          vetas: anillos deformados por ruido, no una diana
arena           grano fino sobre manchas grandes, para las casillas
piedra          manchas y poros; la usan el castillo, las rocas y las piezas
ladrillo        dibujado con rectángulos, no con ruido: un aparejo es una rejilla
cielo           degradado con nubes; va de fondo Y de iluminación de entorno
normalDeAgua    un mapa de NORMALES, no un color: el agua se ve por cómo dobla la luz
```

El ruido es un value noise cíclico con varias octavas —treinta líneas en vez de una
biblioteca—, y es cíclico a propósito para que las texturas se repitan sin costura.

Cuatro cosas que se descubrieron mirando:

- **El agua necesita que la normal se repita varias veces por casilla.** Con una sola onda por
  lago la normal varía tan despacio que no hay reflejo que rompa, y se lee como pintura azul.
- **Las nubes van bajas.** La cámara mira el tablero desde arriba, así que del cielo solo se ve
  la franja del horizonte: puestas altas no las ve nadie.
- **El entorno se prefiltra con `PMREMGenerator`.** Pasarle a `scene.environment` la textura
  cruda obliga a filtrarla al vuelo en cada material.
- **Y el bosque se posiciona con `coord`, como todo lo demás.** Usar el contador del bucle
  (1..15) en vez de `coord` (columna en base 0) desplazaba las sesenta casillas de bosque una
  columna. Es el MISMO tropiezo que ya se dio dibujando el informe: si una escena posiciona con
  `coord`, hay que posicionar con `coord` en todos los sitios.

Los árboles y las rocas van en mallas instanciadas: sesenta casillas por dos o tres piezas cada
una serían casi doscientos objetos, y así son cuatro. El azar del bosque está sembrado, para
que el tablero no cambie de aspecto en cada recarga.

`herramientas/banco-3d.html` monta la escena con una partida inventada, para poder mirar los
cambios sin levantar servidor ni jugar nada.

### Controles de la escena 3D

La cámara orbita alrededor de `objetivo`, un punto que además se desplaza por el plano del
tablero: girar y acercar no bastan para mirar de cerca una esquina. Arrastrar gira; arrastrar
con Mayúsculas, con el botón derecho o con el central desplaza; las flechas desplazan, `C`
vuelve a la vista inicial y `M` amplía o reduce la escena. La leyenda de la esquina lista todo
eso, para no tener que adivinarlo.

Dos detalles que se descubrieron probando y conviene no deshacer:

- El tamaño del lienzo lo vigila un `ResizeObserver` sobre el contenedor, no el `resize` de la
  ventana: al ampliar la escena cambia de tamaño sin que la ventana se entere, y el lienzo se
  quedaba estirado.
- `Mayúsculas` se comprueba en cada `pointermove`, no solo al pulsar: hay entornos que no traen
  el modificador en el `pointerdown`.

Ampliada, la escena tapa el panel lateral, así que una decisión pendiente sería imposible de
contestar: cuando aparece una, la escena se reduce sola.

### El cliente (`src/`)

`App.jsx` es un único componente grande que lleva conexión, lobby, despliegue y partida.
`Tablero3D.jsx` monta la escena de three.js; los rangos se dibujan como texturas de `canvas`
generadas al vuelo y cacheadas en `CACHE_TEXTURAS`.

El cliente deduce `ws://` o `wss://` de `location.protocol`, así que funciona igual detrás de
HTTPS sin configurar nada.

## Despliegue

`render.yaml` define el servicio de Render y `.node-version` fija Node 24. La construcción es
`npm ci --include=dev && npm run build`: el `--include=dev` importa porque `vite` está en
`devDependencies`. El arranque es `npm run servidor`, no `npm start`, para no recompilar en
cada reinicio.
