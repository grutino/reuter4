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

### 0. La búsqueda: el primer nivel lo vale todo — HECHO

**El bot no miraba nada.** `aplicar` no aparecía ni una vez en `bot.js`,
`bot-red.js` ni `rasgos-jugada.js`: se puntuaba el par (posición, jugada) desde el
estado actual y se cogía el máximo. Medio ply, sin ver el tablero resultante ni la
respuesta de nadie. Llevábamos semanas afinando el evaluador de un jugador ciego.

Ahora se juega la jugada y se mira qué puede hacer el siguiente. Como la red
evalúa pares (posición, jugada) y no posiciones sueltas, no se puede «evaluar el
tablero resultante»: se le pregunta a la MISMA red cuánto le gusta al siguiente en
turno su mejor jugada desde ahí. Y en un juego de cuatro el siguiente no siempre
es un enemigo — si es el compañero, suma en vez de restar, y suma menos.

```
                        victorias      coste por turno
sin mirar (medio ply)   90,4% ±1,2        1,8 ms
profundidad 1           94,6% ±2,4         19 ms     <- puesto en el juego
profundidad 2           93,8% ±2,4         39 ms
profundidad 3           93,6% ±2,4         55 ms
```

**Todo el salto está en el primer nivel.** A partir de ahí la curva se aplana y
hasta baja un poco, dentro del ruido. La explicación encaja con el resto: la
búsqueda profunda solo sirve si el evaluador de las hojas es bueno, y el nuestro
predice regular; al bajar tres turnos su error se acumula en cada nivel y se come
lo que aporta ver más lejos. Es el mismo patrón que con los 500 candidatos de
despliegue — **más búsqueda con un evaluador mediocre no compra nada**.

La búsqueda baja por la LÍNEA PRINCIPAL, no por el árbol entero: con doce
candidatas y cuatro jugadores el árbol completo son 12⁴ hojas por turno. Por eso
el coste crece lineal (19, 39, 55) y no exponencial. Falla donde cabe esperar: si
el rival tiene dos respuestas casi igual de buenas y la segunda es la que duele,
no se ve.

**Pendiente**: entrenar también con búsqueda, o volvemos al desajuste del punto
siguiente. Cuesta once veces más por partida, así que es una decisión cara y hay
que medir antes si el modelo entrenado así se comporta distinto.

### 1. Entrenar, medir y jugar el mismo juego — MEDIO HECHO

**Hecho y publicado: el servidor cribaba a 4 y ahora criba a 12.** Valían seis
puntos. El 4 estaba medido, pero con una red que apenas distinguía entre
jugadas; el número se quedó fijo mientras la red mejoraba. Remedido:

```
 4 candidatas   84,2% ±1,3
 8              88,6%  ·  90,8%   (dos semillas)
12              90,3%  ·  90,4%
20              88,4%  ·  92,1%
40              88,4%
```

Entre 8 y 20 no hay señal —el orden se invierte al cambiar de semilla— pero el 4
pierde seis puntos en las dos. Servidor, coevolución y `medir.mjs` leen ahora la
misma constante. La escalera de dificultad aguanta el cambio.

**La lección, que vale más que el número**: un parámetro medido caduca cuando
cambia aquello sobre lo que se midió. `medir.mjs` acepta el número por argumento
para poder volver a barrerlo.

**Hecho también: la coevolución ya puede entrenar por criba** (`--soloRed 0`), y
entonces entrena, mide y juega lo mismo. Cuatro rondas partiendo del modelo
publicado: ninguna lo superó, veredicto 89,3% contra un punto de partida del 90%.
No es un fracaso del cambio —descarta con razón— pero dice que el modelo vigente
no se supera en cuatro rondas.

**Falta**: una noche entera con `--soloRed 0`, y arreglar el listón de adopción.
Se calcula sobre el titular remedido cada ronda, que fluctúa entre 88% y 94% con
±2 de error; cuando al titular le toca una medida afortunada el listón sube a 96%
y ninguna mejora razonable lo pasa. El listón depende del ruido de una medida.

### 2. `humana-08` NO era un agujero — era el camino de medida

Durante varias noches `humana-08` salió como el peor rival del panel, hasta el
38%, y el algoritmo de formaciones encontró una variante suya que ganaba el 100%.
Parecía un agujero concreto: es la única de las once aperturas humanas que
adelanta el mariscal a primera línea (`4 3 5 9 4 3 4`), y las demás lo esconden
detrás.

Medido con la criba correcta, la red **le gana el 82%**, y en el panel completo
`humana-08` está en el 75,6%. Los ocho peores rivales van del 72,9% al 80,9%,
repartidos y sin ningún desastre. **No hay agujero.**

Aquel 38% estaba medido por el camino `solo`, que no es como juega el servidor.
Es la tercera conclusión falsa salida del mismo desajuste, así que ahora el
diagnóstico del nocturno **escribe siempre por qué camino midió** y `medir.mjs`
lo guarda en su salida junto al número de candidatas. Un porcentaje sin el camino
al lado no significa nada.

### 3. Una red es lineal y la otra no, y lo parecían las dos

**Corregido lo que decía este punto.** Ponía que las dos redes eran «casi
lineales» y que por eso no mejoraban, apoyándose en el ajuste de la mejor recta a
sus propias salidas: R² 1,000 en despliegue y 0,97 en jugada, ordenando igual el
99,9% y el 95% de los pares.

La forma de saberlo no es esa. Se construye la red lineal equivalente y **se la
hace jugar**:

```
las dos con capa oculta        90,4% ±1,2
DESPLIEGUE lineal, jugada no   90,0% ±1,2     sin diferencia
JUGADA lineal, despliegue no   50,1% ±1,4     se hunde
las dos lineales               53,3% ±1,4
```

**La red de despliegue sí es lineal.** Sus dieciséis neuronas ocultas no cambian
ni una partida: se puede sustituir por 83 pesos y un sesgo y nadie lo nota.

**La de jugada no lo es, ni de lejos.** Ordena igual que una recta el 95% de los
pares y aun así juega 40 puntos peor al sustituirla. Ese 5% restante no está
repartido: está concentrado justo donde se decide, porque elegir jugada es coger
el máximo de unas cincuenta opciones y basta con equivocarse en las de arriba.

**La lección es de método**: R² y concordancia media engañan cuando lo que
importa es el argmax. Una aproximación que acierta el 95% del orden puede ser
inservible para elegir. La única medida que vale es jugar.

#### Qué hacer con cada una

**Despliegue** — no le falta capacidad, le falta señal. Su pérdida de validación
ronda 0,63-0,69 cuando adivinar a ciegas es 0,693: apenas predice, porque un
despliegue explica poco del resultado de una partida de cuatrocientos turnos. Más
neuronas no van a arreglar eso; mejores etiquetas sí, y por ahí van los juicios,
que la llevaron de coincidir con Patxi el 52% al 92%.

Se probó también a mirar **más candidatos** al desplegar, por si con una
evaluación tan barata compensaba buscar más a fondo. No compensa:

```
 30 candidatos   90,2% ±1,5
120              89,9% ±1,5
500              91,3% ±1,5
```

Diecisiete veces más despliegues mirados y ninguna diferencia. Buscar más a fondo
con un evaluador que apenas predice es afinar la puntería con una brújula
imprecisa. (De paso cayó otra idea mía: creía que la ganancia vendría de que la
red es lineal y evaluar sale gratis. Medido, puntuar 2000 candidatos con la red
cuesta 6 ms y calcular sus rasgos 83 ms — la red nunca fue el cuello de botella.)

**Jugada** — aquí la capacidad sí cuenta, pero mucha menos de la que tiene.

El barrido de entrenar redes de 2, 8, 28 y 64 neuronas salió plano también
midiendo en juego (84,8%, 86,1%, 84,2%, 84,2% ±1,9), pero no valía de mucho:
entrenadas con 800 partidas, las cuatro eran flojas y sus diferencias se perdían
en el ruido. La pregunta buena es otra — **cuántas neuronas usa el modelo que de
verdad juega al 90%**— y se responde apagándoselas de la menos útil a la más
útil, sin entrenar nada:

```
 1 de 28 vivas   43,0% ±2,1     se rompe
 2               86,0% ±1,9
 3               83,8% ±1,9
 4               88,2% ±1,9
 6               90,4% ±1,8     igual que entero
28 (entero)      90,4% ±1,2
```

**Con 6 neuronas juega exactamente igual que con 28.** Las otras 22 se pueden
apagar sin perder una décima. Y el salto está entre 1 y 2: una sola neurona es
casi un modelo lineal y se hunde igual que la aproximación lineal (43% contra
50%), mientras que con dos ya se tiene casi todo.

O sea: la no linealidad es imprescindible y **con muy poca basta**. Buscar
mejoras agrandando la red está descartado con datos; hay que buscarlas en la
señal y en la búsqueda.

### 4. El ancla de la heurística NO se suelta

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

### 5. Juzgar despliegues — HECHO, y ya entran

**Hecho de punta a punta.** El taller vive en el propio juego (`/juicios`): se
cosechan las partidas terminadas, se comparan dos colocaciones del mismo ejército
y lo valorado entra en el entrenamiento. Están las 124 parejas valoradas, que dan
99 órdenes directas y 1.018 pares cruzados desde los empates con signo.

Y entran de verdad en los dos sitios: `entrenar-despliegue.mjs` y la coevolución
del nocturno, que antes los ignoraba por completo.

Medido lo que aportan, con un barrido de dosis:

```
pasadas   victorias   acierto en juicios apartados
   0         78%              73%
   1         78%              77%
   8         79%              92%      <- el punto
  30         58%              92%
```

Ocho pasadas es donde aprende todo lo que hay que aprender y todavía no estorba.
La red partía de coincidir con Patxi el 52% de las veces —una moneda— y acaba en
el 92% sobre pares que no ha visto.

**Falta**: nada para que funcionen. Más juicios siempre suman, sobre todo de
partidas jugadas de verdad, que son los que se sirven primero.

### 6. Los tres rasgos de defensa — HECHO

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

### 7. El desacuerdo sobre el precio de la información

**Sigue sin respuesta**, y es la pregunta más interesante abierta. La red da signo **positivo** a
`delatarmeAhora`: cree que delatarse pronto compensa. Sabe lo que cuesta —las piezas que se
delatan mueren el 73% de las veces y las que no, el 8%— y aun así paga, porque esas jugadas son
las rápidas.

Tres lecturas posibles: que el entorno siga sin castigar bastante la fuga, que sea correlación
—esas piezas mueren por exponerse, no por estar identificadas— o que la red tenga razón dentro de
este juego y el consejo humano valga para partidas entre personas.

### 8. Pulir el visor 3D — HECHO

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

### 9. El informe de las redes — HECHO

Pérdida y acierto de entrenamiento y validación en cada punto de la curva —la distancia entre las
dos líneas de acierto *es* el sobreajuste—, separación entre **entre rondas** y **dentro de la
ronda**, y ahora **abre con «Cuánta red se está usando»**: neuronas útiles por ablación, inertes,
la mayor, R² del ajuste lineal y en qué porcentaje de pares ordena como una recta. Se calcula en
cada `npm run informe-redes` sobre los mismos vectores que la sensibilidad, sin volver a jugar las
partidas.

### 10. Los juicios de jugada, segunda versión

**Apagados** (`pasadasJuicios: 0`). Los primeros 740 enseñaban a **no terminar la partida**: 0 de
12 decididas contra 12 de 12. Las jugadas marcadas como malas eran las que delatan, que son las
rápidas, y la red generalizó «no te delates» a los 400 turnos.

Hacen falta **muchas más y repartidas por toda la partida**. `npm run cosechar` ya mete en el
banco las posiciones donde la red discrepa de lo que se jugó, que es donde un juicio vale más.

### 11. La renuncia a la bandera del compañero — HECHO

Por defecto no se carga, porque cargarla la congela. El matiz nuevo: renunciar solo la protege
**mientras el que la tapa aguante**. Si ahí me matan, quien gana el duelo avanza a mi casilla, cae
sobre la bandera y se la lleva — mi renuncia no la ha protegido, la ha entregado con mi cadáver.

Se carga entonces si un enemigo **conocido** que me gana está al lado, o si hay un desconocido y
más de la mitad de su bolsa oculta me ganaría. Solo cuerpo a cuerpo: un cañonazo me mata pero deja
la bandera donde está y el que disparó sigue lejos.

### 12. Siluetas: hace falta una foto tuya

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
