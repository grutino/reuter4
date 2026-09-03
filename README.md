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

### 0-bis. La defensa no razona con probabilidades, y el ataque sí

Asimetría medida en el código:

```
para ATACAR:    valorEsperadoDelDuelo   probabilidad sobre la bolsa oculta
para DEFENDER:  hayDesconocido          un booleano
```

El bot calcula finamente lo que puede ganar, pero **todos los peligros desconocidos le parecen
iguales**. Y no lo son: si el mariscal enemigo está localizado en el flanco contrario, un
desconocido junto a mi general apenas puede hacerle nada salvo que sea un cañón. Eso es
exactamente lo que un jugador humano aprovecha, y lo que hace que revelar sea caro — no solo
por la pieza revelada, sino porque **baja el riesgo de todas las decisiones del rival en el
resto del tablero**.

**Falta**: un rasgo `riesgoConDesconocido` = probabilidad de que un desconocido vecino me gane,
según la bolsa. Medido antes de escribirlo: se activa en el **4,2%** de las jugadas con **49
valores distintos**, así que hay señal de sobra y está graduado.

Y con ello se abre lo que de verdad decide el final de la partida según el jugador: **control
del centro, superioridad de calidad e información revelada**. Las dos primeras tienen rasgos
(`presenciaEnElCentro`, `ventajaDePiezas`); la tercera es esta.

### 0. El desacuerdo sobre el precio de la información, sin resolver

740 juicios humanos marcaron como malas las jugadas que delatan —capitán dos casillas,
explorador en línea— porque regalan información en la apertura. La red opina lo contrario:
con el rasgo `delatarmeAhora` disponible, le da signo **positivo**.

Y no es que no lo sepa. Medido: **las piezas que se delatan mueren el 73% de las veces y las
que no, el 8%**. La red conoce el coste y aun así prefiere pagarlo, porque esas jugadas son las
rápidas. Se comprobó por la vía dura: entrenada con los juicios dejó de terminar partidas
—0 de 12 decididas, 400 turnos— y perdía todas contra el panel.

Tres lecturas posibles y no sé cuál es:

- **El entorno no castiga bastante la fuga de información.** Los rivales de entrenamiento
  explotan los rangos revelados para atacar, pero puede que no lo suficiente: un humano los
  usa para deducir por descarte dónde están las piezas clave, y eso el panel no lo hace.
- **Es correlación y no causa.** Las piezas que se delatan son las que se mueven mucho y van al
  frente: puede que mueran por exponerse, no por estar identificadas.
- **La red tiene razón dentro de este juego** y el consejo humano vale para partidas entre
  personas, donde el rival castiga la información durante cuarenta turnos más.

Para distinguirlas haría falta un rival que explote la información de verdad —por ejemplo uno
que deduzca por descarte— y volver a medir. Mientras tanto los juicios están **apagados por
defecto** (`pasadasJuicios: 0`) con toda la explicación en el código.

Ordenado por lo que desbloquea a lo demás. Cada punto dice qué hay hecho, qué falta y con qué
cuidado, para poder retomarlo sin volver a averiguarlo.

### 1. Muestreo por escenarios: que se aprendan las tácticas raras

Es el cuello de botella de todo lo demás. Los ejemplos salen de partidas enteras etiquetadas con
el resultado final, así que una jugada decisiva y una intrascendente de la misma partida ganada
reciben la **misma** etiqueta. Medido sobre 3.420 vectores: `tapaLineaAlAnillo` se activa en el
0,1% de los casos y `disparoAlCoronador` en ninguno. Un rasgo así no aporta gradiente por muchas
horas que entrene.

**Hecho**: el banco de escenarios (`npm run escenarios`) guarda posiciones donde la cosa está en
juego y las etiqueta jugando cada candidata hasta el final — una etiqueta por JUGADA, no por
partida. El replay reproduce una partida terminada exactamente, y `npm run analizar` busca los
momentos decisivos.

**Falta**: alimentar el banco con partidas reales y mezclar esos ejemplos en el entrenamiento.

**Cuidado**: medir el impacto de una jugada suelta es muy ruidoso. La misma posición medida dos
veces con 8 tiradas solo correlaciona **0,39** consigo misma. Eso pone un techo a cualquier
detector barato —ninguna señal puede predecir mejor de lo que la medida se predice a sí misma—
así que **no se pueden ordenar las jugadas de una partida por importancia** sin gastar decenas
de tiradas por jugada. Del agregado de muchas posiciones con pocas tiradas sí se aprende.

### 2. Mezclar los juicios humanos en el entrenamiento

`npm run juzgar` levanta la sala donde se marcan candidatas buena/mala/indefinida, respetando la
regla de información —se ve lo que vería quien mueve—. La pérdida por pares que hace falta ya
existe y está probada.

**Falta**: leer `escenarios/juicios.json` y mezclarlo, y **calibrar cuánto pesa un juicio** frente
a un par de la heurística. Eso quiero hacerlo con juicios reales, no inventando el número, así
que espera a que haya unos cuantos.

### 3. Soltar el ancla de la heurística

`--anclaPares 0`. Medido: con el modelo actual, decidir con la red sola sobre todas las jugadas
y decidir con la heurística cribando cuatro **empatan a 65%**. O sea que la heurística ya no
aporta a la decisión, solo al arranque y a la medida. Falta comprobar si las redes aguantan sin
sus pares de anclaje.

### 4. Correr el nocturno una noche entera

`npm run nocturno -- --horas 8`. Está construido y probado en corto, pero nunca ha corrido de
verdad. No sabemos dónde está el techo: la última tirada de diez rondas subió de 50% a 90%.

### 5. Un solo informe de partida

Hoy hay un botón para el relato y otro para el análisis. Debería ser **uno con todo**, y las
jugadas determinantes no en un bloque aparte sino **sobre el hilo que ya existe**: fondo verde
suave si la jugada fue buena, rojo suave si fue mala, con la evaluación que ya se calcula. El
hilo es la línea de tiempo natural de la partida; duplicarla en una tabla al lado obliga a leer
dos veces lo mismo.

### 6. Simplificar el informe de las redes

Hoy mezcla coevolución, panel y redes, y de las redes enseña sobre todo el **último**
entrenamiento en vez de la evolución. Se quiere ver dos planos: **entre rondas** (pérdida,
acierto y época útil ronda a ronda) y **dentro de la ronda** (las curvas por época). Lo demás,
abajo o en otra página.

**Ya se guarda** por ronda y por red, en `modelos/coevolucion.json`: pérdida de validación,
acierto, `epocasUtiles` —en qué época se dejó de mejorar, la señal directa de sobreajuste—,
calibración en diez cubos y la curva de pérdida por época.

**Falta registrar**: acierto por época y acierto de entrenamiento. Sin esos dos no se puede
pintar la pareja de curvas que enseña el sobreajuste, la de entrenamiento subiendo mientras la
de validación se estanca.

### 7. Tácticas que aún no tienen rasgo

**Medido primero, y el resultado cambia el plan.** De cinco candidatos, solo dos se activan lo
bastante como para que la red los aprenda:

```
defiendoMiBandera     6,91%   sí
bloqueoLateral       26,04%   sí
zonaFavorable         0,30%   no
sondeoBarato          0,15%   no
victoriaQueAsciende   0,02%   no
```

Los tres descartados son todos **condicionados a un ataque**, y ahí está la razón de fondo: de
69.830 jugadas legales, el 97,9% son movimientos, el 1,9% ataques y el 0,22% disparos. Cualquier
rasgo de combate tiene ese techo, por muy bien escrito que esté.

**Hecho**: el banco de escenarios incluye ahora siempre los ataques y disparos disponibles y
busca posiciones con combate, lo que sube la proporción del 2,1% al 12,6%.

**Falta**: añadir los dos que pasaron el corte, y volver a medir los descartados ahora que el
banco los muestrea. Cambiar los rasgos invalida modelos y banco, así que conviene hacerlo entre
entrenamientos y no en medio.

**Ya hechas**: cañones tras los lagos (`cubiertoPorLago`), batir el castillo y al que va a
coronar, llevar el cañón a posición, tapar la línea de tiro rival y cubrir el anillo entero.

### 8. Afinar la renuncia a la bandera del compañero

Ahora un bot nunca carga la bandera de su compañero, porque cargarla la congela: quien la lleva
no puede coronarla y su dueño ya no la recupera salvo que caiga en combate. Pero renunciar
tampoco es gratis —quien renuncia se queda encima y la tapa— y **si un enemigo está a punto de
llevársela, cargarla y negársela puede compensar**. Falta ese matiz.

### 9. Siluetas: hace falta una foto tuya

`src/siluetas-datos.js` está **generado** por `herramientas/extraer-siluetas.py` a partir de una
foto de la tarjeta de referencia que **no está en el repositorio** —solo se versiona la silueta
derivada—. Así que esto no lo puede hacer nadie más: hay que aportar una foto mejor y
regenerarlas.

```bash
python3 herramientas/extraer-siluetas.py TU_FOTO.png > src/siluetas-datos.js
```

`--cierre` y `--umbral` gobiernan cuánto se macizan las figuras y cuánto dibujo interior se
graba. Míralas a 46 px antes de dar nada por bueno, que es el tamaño real en el tablero.

**Urgencia baja**: a ese tamaño la silueta sola no basta —está medido, las dos más confundibles
eran explorador y general— y por eso la ficha lleva el galón, que ya lo resuelve. Con él, la
distancia visual entre dos fichas correlaciona 0,85 con su distancia de rango.

## Lo que hay y no se toca

- Reconexión: si te caes en mitad de una partida, la máquina juega por ti al minuto. Al volver
  con el mismo navegador recuperas tu puesto, porque el identificador vive en `localStorage`.
- No hay reloj de turno ni límite de tiempo.
- Una sala sin humanos se borra sola, así que no se puede montar una partida de cuatro bots para
  verla jugar. Y quien deja su asiento pierde el papel de anfitrión, que pasa al siguiente humano.
