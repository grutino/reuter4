# Reuter4

Juego de tablero para cuatro, en dos bandos de dos: cuatro ejércitos, tablero en 3D y
partidas online. Rojo y Azul contra Verde y Amarillo, cada jugador enfrente de su compañero.
Gana el bando que corone cualquiera de sus dos banderas en la torre del castillo.

Proyecto personal, sin ánimo de lucro. El reglamento se inspira en el del *Stratego 4* de
Jumbo, incluida su variante por equipos; la aplicación, el motor, los bots y el nombre son
propios y no guardan relación con Jumbo ni con la marca Stratego.

## Qué hay dentro

```
src/motor/      reglas puras, sin interfaz: tablero, motor, pruebas y simulación
src/motor/      también la inferencia de los bots: rasgos, red y modelos publicados
src/            cliente React con el tablero en three.js
servidor/       servidor Node con WebSocket: guarda el estado y mueve los bots
entrenamiento/  todo lo que sirve para APRENDER; el juego no importa nada de aquí
herramientas/   utilidades sueltas: publicar modelos, juzgar escenarios, banco 3D
```

El servidor es la autoridad. Los clientes solo reciben los rangos de sus propias piezas,
así que ningún jugador puede espiar las del rival mirando el navegador.

Durante la partida se ve el hilo de jugadas, para poder repasar lo que pasó en turnos
anteriores, y el contador de victorias de cada bando camino del reclutamiento. Quien creó la
partida, y solo esa persona, puede pararla (se cierra pero la sala queda para repasarla) o
borrarla del todo.

## Requisitos

Node 18 o superior.

## Poner en marcha

```bash
npm install
npm test          # 100 pruebas del motor
npm run simular   # salud de los bots y duelo entre los nuevos y los viejos
```

`npm run simular` acepta dos números: partidas de salud y partidas de duelo.
`node src/motor/simulacion.js 0 2000` se salta la salud y mide el duelo a lo grande.

Durante el desarrollo hacen falta dos terminales:

```bash
npm run servidor  # servidor en el puerto 8080
npm run dev       # cliente con recarga en caliente, en el 5173
```

Abre `http://localhost:5173`. Vite redirige las conexiones `/ws` al servidor.

Para probar una partida entre varios, abre el juego en varias ventanas (o en ventanas de
incógnito, porque el nombre se guarda por navegador) y cubre los puestos que falten con bots.

## Producción en un solo proceso

```bash
npm start   # compila el cliente y arranca el servidor sirviendo dist/
```

Con eso, `http://localhost:8080` sirve el juego entero. Variables útiles:

- `PORT`: puerto de escucha, 8080 por defecto.
- `R4_ESTADO`: fichero donde se guardan las salas, `servidor/salas.json` por defecto.

## Publicarlo en internet

**Importante**: GitHub Pages, Netlify y similares solo sirven ficheros estáticos, así que
por sí solos no valen: este juego necesita un proceso Node vivo para el WebSocket. Tienes
dos caminos.

### Opción A: plataforma de aplicaciones (lo más rápido)

En Render, Railway, Fly.io o similar, crea un servicio web de tipo Node apuntando a este
repositorio, con:

- comando de construcción: `npm ci --include=dev && npm run build`
- comando de arranque: `npm run servidor`

El `--include=dev` no es opcional: `vite` vive en `devDependencies` y hace falta para compilar,
así que un `NODE_ENV=production` sin esa bandera dejaría el build sin compilador. Y el arranque
es `npm run servidor`, no `npm start`, porque `npm start` volvería a compilar en cada reinicio.

La plataforma inyecta `PORT` y termina el HTTPS por ti. El cliente deduce el protocolo de
`location.protocol`, así que pasa a `wss://` él solo, sin tocar nada.

Ten en cuenta que en los planes gratuitos el disco suele ser efímero: las salas guardadas en
`salas.json` se pierden al reiniciar. Para partidas de una tarde da igual.

#### Render, en concreto

Este repositorio ya trae un `render.yaml` (blueprint) con el servicio definido y un
`.node-version` que fija Node 24. Con eso, en Render basta con **New > Blueprint**, elegir el
repositorio y aplicar: los comandos, la región y el health check salen del fichero.

Dos avisos sobre el plan gratuito, que importan bastante en un juego con WebSocket:

- El servicio se duerme tras unos 15 minutos sin tráfico. Al despertar tarda alrededor de un
  minuto y, mientras tanto, las conexiones abiertas se cortan y la partida en curso se pierde.
- No admite discos persistentes. Si quieres que las salas sobrevivan a un reinicio, hace falta
  un plan de pago: añade un disco al servicio y apunta `R4_ESTADO` al punto de montaje, por
  ejemplo `/var/datos/salas.json`.

### Opción B: tu propio servidor con nginx

```bash
git clone TU_REPOSITORIO reuter4 && cd reuter4
npm install && npm run build
```

Servicio de systemd en `/etc/systemd/system/reuter4.service`:

```ini
[Unit]
Description=Reuter4
After=network.target

[Service]
WorkingDirectory=/ruta/a/reuter4
ExecStart=/usr/bin/node servidor/servidor.mjs
Environment=PORT=8080
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now reuter4
```

Y en nginx, un bloque que pase también la conexión WebSocket:

```nginx
server {
    server_name reuter4.tudominio.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Las tres líneas de `Upgrade` y `Connection` son las que suelen faltar: sin ellas la web carga
pero el juego se queda en "sin conexión". Después, `sudo certbot --nginx` para el certificado,
y el cliente pasará a `wss://` él solo.

## Publicarlo en git

```bash
git init
git add .
git commit -m "Reuter4: motor, servidor y cliente 3D"
git branch -M main
git remote add origin git@github.com:TU_USUARIO/reuter4.git
git push -u origin main
```

`node_modules/`, `dist/` y `servidor/salas.json` ya están en `.gitignore`.

## Los bots

Deciden con **dos redes neuronales** entrenadas jugando: una monta el despliegue inicial y otra
elige cada jugada. Están en `src/motor/modelos/` y son JSON de números —1.361 y 2.017
parámetros— que el juego evalúa mientras juega, sin dependencias.

Si no hay modelo publicado, o si sus entradas no cuadran con los rasgos de esa versión del
código, los bots caen a la **heurística escrita a mano** y el servidor lo dice al arrancar. Esa
comprobación no es decorativa: un modelo viejo se carga sin dar ningún error y juega con basura.

Hay **cinco niveles de dificultad** por bot, con deslizador para quien creó la partida y
cambiables en mitad de ella. Medidos contra el nivel 2: 38%, 50%, 74%, 82% y 95% de victorias.
El nivel 1 se distingue por **no recordar** los rangos ya vistos, y se nota de una forma muy
humana: vuelve a estrellarse contra el mariscal que ya le enseñaste.

### Solo miran información pública

Corren dentro del servidor, con el estado completo delante, pero no leen el rango oculto de
ninguna pieza ajena —ni el del compañero—. Lo que sí usan es lo que ha quedado a la vista de la
mesa: quien sobrevive a un duelo, y quien se delata al moverse, porque solo el explorador
recorre más de una casilla en línea y solo el capitán encadena dos con giro.

Dos pruebas lo vigilan, y la segunda hizo falta: el servidor dejó de mover con la heurística y
pasó a mover con la red, que es otro camino entero. Compara los **rasgos** de dos escenarios que
solo se diferencian en el rango escondido —si el vector de entrada es idéntico, ninguna red
posible puede distinguirlos—, que es más fuerte que comparar decisiones.

### Al terminar

Se destapan los cuatro ejércitos en el tablero y hay un informe imprimible con los despliegues
iniciales, un diagrama de flechas por bando y el hilo completo. Y otro botón que además
**analiza** la partida: vuelve a jugarla desde las posiciones dudosas para ver si otra jugada
habría cambiado el resultado. Cada cifra lleva su error, porque medir el impacto de una jugada
suelta es ruidoso y sin ese aviso el listado parece decir cosas que no dice.

## Qué falta por pulir

En el orden en que conviene retomarlo. Cada punto dice qué hay hecho, qué falta y por qué está
en ese sitio.

### 0. Se entrena por un camino y se juega por otro

**Lo más importante que hay abierto.** El servidor juega por CRIBA: `jugadaDeBot`
deja que la heurística elija las mejores candidatas y la red solo las ordena.
Pero la coevolución entrena con `--soloRed 1`, donde la red puntúa TODAS las
jugadas legales. Son dos formas distintas de jugar, y se nota:

```
                        camino solo      camino criba
                     (como se entrena)  (como juega el servidor)
tras el nocturno         89,8% ±1,1        83,4% ±1,1
el modelo publicado      89,0% ±1,1        90,2% ±1,1
```

El modelo recién entrenado es el mejor de los dos **en el camino con el que se
entrena** y el peor **en el camino con el que de verdad se juega**, por casi
siete puntos. Se está optimizando algo que luego no se usa.

Por eso el modelo publicado sigue siendo el bueno y no se ha sustituido.

Lo siguiente es alinear las dos cosas, y la dirección natural es entrenar con
`--soloRed 0`: entrenar como se juega, no al revés. Antes de darlo por hecho hay
que medirlo, porque el camino solo tiene una ventaja teórica -no queda atado al
criterio de la heurística para elegir qué mirar-, pero esa ventaja no sirve de
nada si nadie juega así.

**Cuidado al medir esto**: `herramientas/medir.mjs` toma el camino como quinto
argumento y los dos NO son comparables entre sí. Confundirlos ya costó anunciar
un +3 que no existía, y una segunda vez leer como regresión de la reválida lo
que era una medida mal alineada.

### 1. Las redes son casi lineales, y eso explica la meseta

**El hallazgo que reordena el resto.** Medido por ablación —poner a cero la salida de cada
neurona oculta y ver cuánto se mueve la predicción, que es la única prueba que no depende de la
escala de los pesos:

```
red de jugada     72-28-1    24 de 28 no mueven NADA apreciable · la mayor vale 0,382
red de despliegue 83-16-1    11 de 16                           · la mayor vale 0,412
```

Cuentan tres o cuatro según dónde pongas el corte —hay una justo en la frontera—, pero el fondo
no depende del umbral: en las dos redes **una sola neurona** hace casi todo el trabajo.

Y ajustando la mejor función **lineal** a la propia red sobre 1.440 entradas de partidas reales:

```
red de jugada       R² 0,916   ordena igual que ella en el 92% de los pares
red de despliegue   R² 1,000   ordena igual en el 100%
```

La red de despliegue **es** una función lineal: sus dieciséis neuronas ocultas no cambian ni una
decisión, y podría sustituirse por 83 pesos y un sesgo sin que nadie lo notara. La de jugada está
al 92% del camino.

Esto explica el barrido de capacidad que salió plano —2, 8, 28 y 64 ocultas daban el mismo
59,6%— sin recurrir a neuronas muertas, que ya di por explicación una vez y era falso. **No falta
capacidad: falta una señal que no sea lineal.** Y no lo es por casualidad: la heurística es una
suma ponderada de rasgos, o sea lineal por construcción, y destilar su orden enseña justamente
eso. La red converge a la mejor recta y ahí se queda.

De ahí que los dos puntos siguientes sean los que valen la pena.

### 2. El ancla de la heurística NO se suelta

**Resuelto, y al revés de lo que decía este punto.** Aquí ponía que la heurística
«ya no aporta a la decisión» porque decidir con la red sola (90,3% ±1,0) y con la
heurística cribando (91,6% ±1,0) empatan dentro del error. Esa medida era buena
pero la conclusión no: estaba hecha sobre una red **ya entrenada con el ancla
puesta**. Otra cosa muy distinta es reentrenar sin ella.

Medido con la misma configuración, una ronda de 400 partidas:

```
con --anclaPares 1   aspirante 85%  ·  titular 87%     competitivo
con --anclaPares 0   aspirante  1%  ·  titular 87%     demolición
                     aspirante 11%  ·  titular 88%
```

Una noche entera —cinco sesiones, 0 rondas adoptadas— se leyó como
«no encuentra por dónde mejorar». No era eso: cada ronda producía una red
arruinada que el sistema descartaba, correctamente. El ancla no era un resto del
pasado, es lo que sostiene el orden de las jugadas cuando la señal de valor sola
no basta.

Queda una pregunta abierta y más fina: si el ancla se puede **aflojar** por
rondas —empezar con ella y bajarla— en vez de quitarla de golpe.

### 2. Juzgar despliegues

**Hecho**: `npm run juzgar-despliegues` compara dos colocaciones del mismo ejército y guarda cuál
prefieres; `entrenar-despliegue.mjs` las aplica con la pérdida por pares en **dosis fija** por
época. Cada partida terminada se archiva y `npm run cosechar` mete sus cuatro despliegues en el
pozo, que se sirve antes que lo generado.

**Falta**: juzgar. Sin juicios no hay nada que aprender, y son la señal con más posibilidades de
romper la linealidad del punto 0: una opinión humana sobre una formación no es una suma ponderada
de sus rasgos.

Se comparan de dos en dos y no se puntúan de uno en uno a propósito: dar notas absolutas deriva
con el cansancio, elegir entre dos no. Y «parecidos» es información, no pereza.

### 3. Los tres rasgos de defensa — HECHO

Escritos y medidos. La firma de rasgos pasa a `94ad006f` y el tamaño a **75**, así que **todo
modelo anterior queda invalidado** y hay que reentrenar de cero: es justo por eso que este punto
iba el último.

```
                        activas   valores   qué mide
riesgoConDesconocido      2,9%       83     qué parte de la bolsa oculta me gana en el destino
defiendoMiBandera        30,2%        3     quedo encima, al lado, o a dos pasos de mi bandera
bloqueoLateral           14,2%        6     quedo interpuesto entre un enemigo y mi bandera
```

El primero cierra una asimetría real: para **atacar** había `valorEsperadoDelDuelo`, una
probabilidad sobre la bolsa; para **defender** solo `hayDesconocido`, un booleano. Todos los
peligros desconocidos le parecían iguales al bot, y no lo son: con el mariscal enemigo ya
localizado en el otro flanco, un desconocido junto a mi general apenas puede hacerle nada.

Los otros dos salieron **muertos al 0,0%** en el primer intento, por dos motivos que no dan
error: `DISTANCIA` mide al **castillo**, no entre dos casillas, y `coord()` devuelve un **array**,
no `{columna, fila}`. Hay ahora una prueba que falla si cualquiera de los tres baja del 1% de
activación o pasa del 95%.

### 4. El desacuerdo sobre el precio de la información

**Sigue sin respuesta**, y es la pregunta más interesante abierta. La red da signo **positivo** a
`delatarmeAhora`: cree que delatarse pronto compensa. Sabe lo que cuesta —las piezas que se
delatan mueren el 73% de las veces y las que no, el 8%— y aun así paga, porque esas jugadas son
las rápidas.

Tres lecturas posibles: que el entorno siga sin castigar bastante la fuga, que sea correlación
—esas piezas mueren por exponerse, no por estar identificadas— o que la red tenga razón dentro de
este juego y el consejo humano valga para partidas entre personas.

### 5. Pulir el visor 3D — HECHO

- **La última casilla queda iluminada**: emisión blanca con la propia textura como mapa, para que
  se vea *piedra iluminada* y no un cilindro blanco, y latiendo despacio (2,2 Hz, para no competir
  con las llamas, que titilan a 7). El anillo y la torre se encienden **enteros** aunque sean
  varias piezas de geometría; el fuste de la torre no era ni siquiera una casilla registrada y
  ahora lo es, solo a efectos de luz.
- El contador de promoción sube por encima de la ficha cuando su casilla está ocupada: a ras de
  baldosa quedaba **debajo** de un disco opaco, o sea pintado y no visible.
- Las banderas ya iban a doble cara con emisión propia, y las siluetas ya giran hacia el lado de
  su ejército.
- Las siluetas van en **blanco** en informes y herramientas y en **negro** en el visor.

### 6. El informe de las redes — HECHO

Pérdida y acierto de entrenamiento y validación en cada punto de la curva —la distancia entre las
dos líneas de acierto *es* el sobreajuste—, separación entre **entre rondas** y **dentro de la
ronda**, y ahora **abre con «Cuánta red se está usando»**: neuronas útiles por ablación, inertes,
la mayor, R² del ajuste lineal y en qué porcentaje de pares ordena como una recta. Se calcula en
cada `npm run informe-redes` sobre los mismos vectores que la sensibilidad, sin volver a jugar las
partidas.

### 7. Los juicios de jugada, segunda versión

**Apagados** (`pasadasJuicios: 0`). Los primeros 740 enseñaban a **no terminar la partida**: 0 de
12 decididas contra 12 de 12. Las jugadas marcadas como malas eran las que delatan, que son las
rápidas, y la red generalizó «no te delates» a los 400 turnos.

Hacen falta **muchas más y repartidas por toda la partida**. `npm run cosechar` ya mete en el
banco las posiciones donde la red discrepa de lo que se jugó, que es donde un juicio vale más.

### 8. La renuncia a la bandera del compañero — HECHO

Por defecto no se carga, porque cargarla la congela. El matiz nuevo: renunciar solo la protege
**mientras el que la tapa aguante**. Si ahí me matan, quien gana el duelo avanza a mi casilla, cae
sobre la bandera y se la lleva — mi renuncia no la ha protegido, la ha entregado con mi cadáver.

Se carga entonces si un enemigo **conocido** que me gana está al lado, o si hay un desconocido y
más de la mitad de su bolsa oculta me ganaría. Solo cuerpo a cuerpo: un cañonazo me mata pero deja
la bandera donde está y el que disparó sigue lejos.

### 9. Siluetas: hace falta una foto tuya

`src/siluetas-datos.js` está generado por `herramientas/extraer-siluetas.py` a partir de una foto
que **no está en el repositorio**, así que esto no lo puede hacer nadie más.

```bash
python3 herramientas/extraer-siluetas.py TU_FOTO.png > src/siluetas-datos.js
```

**Urgencia baja**: a 46 px la silueta sola no basta —está medido— y por eso la ficha lleva el
galón, que ya lo resuelve.

## Lo que hay y no se toca

- Reconexión: si te caes en mitad de una partida, la máquina juega por ti al minuto. Al volver
  con el mismo navegador recuperas tu puesto, porque el identificador vive en `localStorage`.
- No hay reloj de turno ni límite de tiempo.
- Una sala sin humanos se borra sola, así que no se puede montar una partida de cuatro bots para
  verla jugar. Y quien deja su asiento pierde el papel de anfitrión, que pasa al siguiente humano.
