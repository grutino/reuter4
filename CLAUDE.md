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
npm test              # 68 pruebas del motor; sale con código 1 si falla alguna
npm run simular       # salud de los bots + duelo entre el bot con memoria y el clásico
npm run entrenar      # autojuego evolutivo de los pesos; escribe el informe en cada generación
npm run informe       # rehace la página de seguimiento desde los modelos guardados
npm run build         # compila el cliente a dist/
npm run servidor      # servidor en el 8080 (sirve dist/ y el WebSocket)
npm run dev           # cliente Vite en el 5173, con /ws redirigido al 8080
npm start             # build + servidor, producción en un solo proceso
```

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
arena.mjs            una partida, un enfrentamiento; todo el azar sale de una semilla
paralelo.mjs         piscina de obreros persistente + trocear/sumar combates largos
obrero.mjs           un hilo que juega lo que le mandan
entrenar-pesos.mjs   estrategia evolutiva con recombinación ponderada
informe.mjs          página de seguimiento con SVG, sin dependencias
modelos/             artefactos generados (JSON con pesos e historia)
informe/index.html   la página; se reescribe en cada generación
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
