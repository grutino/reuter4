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

### 1. Leer el diagnóstico del nocturno

Lo primero, porque condiciona todo lo demás. `entrenamiento/modelos/diagnostico.md` dice hasta
dónde llegó, qué rivales siguen ganando y qué rasgos mueven cada red — incluidos los planos, que
son candidatos a podar.

Es además **el primer entrenamiento largo cuya medida es comparable**: hasta ahora la vara se
movió tres veces por tocar `PESOS_BASE`, y desde hoy los rivales del panel juegan con
`PESOS_VARA`, una copia congelada.

### 2. Los tres rasgos que ya están medidos

Van **juntos y después del nocturno**, porque cambiar la firma invalida modelos y banco.

```
riesgoConDesconocido   4,2% de las jugadas · 49 valores    la defensa, con probabilidad
defiendoMiBandera      6,9%                                
bloqueoLateral        26,0%                                
```

El primero es el que más promete y sale de una asimetría real: para **atacar** hay
`valorEsperadoDelDuelo`, que es una probabilidad sobre la bolsa; para **defender** solo hay
`hayDesconocido`, un booleano. Todos los peligros desconocidos le parecen iguales al bot, y no lo
son: con el mariscal enemigo localizado en el otro flanco, un desconocido junto a mi general
apenas puede hacerle nada. Ahí está la mitad del precio de revelar que no estábamos contando.

### 3. El desacuerdo sobre el precio de la información

**Sigue sin respuesta**, y es la pregunta más interesante abierta. La red da signo **positivo** a
`delatarmeAhora`: cree que delatarse pronto compensa. Sabe lo que cuesta —las piezas que se
delatan mueren el 73% de las veces y las que no, el 8%— y aun así paga, porque esas jugadas son
las rápidas.

El reentrenamiento contra el rival que caza lo revelado **adoptó cero rondas**, así que no llegó
a haber red nueva que medir. Con el nocturno y los rasgos del punto 2 habrá que volver a mirarlo.

Tres lecturas posibles: que el entorno siga sin castigar bastante la fuga, que sea correlación
—esas piezas mueren por exponerse, no por estar identificadas— o que la red tenga razón dentro de
este juego y el consejo humano valga para partidas entre personas.

### 4. Soltar el ancla de la heurística

`--anclaPares 0`. Medido: decidir con la red sola y decidir con la heurística cribando cuatro
**empatan a 65%**, así que la heurística ya no aporta a la decisión — solo al arranque y a la
medida. Falta comprobar si las redes aguantan sin sus pares de anclaje.

### 5. Muestreo por escenarios desde partidas reales

**Hecho**: el banco (`npm run escenarios`) etiqueta jugada a jugada en vez de por resultado de
partida, incluye siempre los ataques y disparos disponibles —lo que sube su proporción del 2,1%
al 12,6%— y el replay reproduce una partida terminada exactamente.

**Falta**: alimentarlo con partidas tuyas de verdad, no solo sintéticas.

**Cuidado**: medir el impacto de una jugada suelta es muy ruidoso —la misma posición medida dos
veces con 8 tiradas solo correlaciona 0,39 consigo misma— así que no se pueden **ordenar** las
jugadas de una partida por importancia sin gastar decenas de tiradas. Del agregado sí se aprende.

### 6. Terminar de limpiar el informe de las redes

**Hecho**: se registran pérdida y acierto de entrenamiento y validación en cada punto de la
curva —la distancia entre las dos líneas de acierto *es* el sobreajuste— y el informe separa
**entre rondas** de **dentro de la ronda**.

**Falta**: la limpieza visual. Sigue mezclando coevolución, panel y redes en una sola página.

### 7. Los juicios humanos, segunda versión

**Apagados** (`pasadasJuicios: 0`). Los primeros 740 enseñaban a **no terminar la partida**: 0 de
12 decididas contra 12 de 12. Las jugadas marcadas como malas eran las que delatan, que son las
rápidas, y la red generalizó "no te delates" a los 400 turnos.

Para volver a intentarlo hacen falta **muchas más y repartidas por toda la partida**, no
concentradas en la apertura. Su valor hasta ahora ha sido **diagnóstico**: revelaron que faltaba
vocabulario para el precio de la información, y de ahí salió `delatarmeAhora`.

### 8. Afinar la renuncia a la bandera del compañero

Ahora un bot nunca la carga, porque cargarla la congela. Pero renunciar tampoco es gratis —quien
renuncia se queda encima y la tapa— y **si un enemigo está a punto de llevársela, cargarla y
negársela puede compensar**. Falta ese matiz.

### 9. Siluetas: hace falta una foto tuya

`src/siluetas-datos.js` está generado por `herramientas/extraer-siluetas.py` a partir de una foto
que **no está en el repositorio**, así que esto no lo puede hacer nadie más.

```bash
python3 herramientas/extraer-siluetas.py TU_FOTO.png > src/siluetas-datos.js
```

**Urgencia baja**: a 46 px la silueta sola no basta —está medido— y por eso la ficha lleva el
galón, que ya lo resuelve. Con él, la distancia visual entre dos fichas correlaciona 0,85 con su
distancia de rango.

## Lo que hay y no se toca

- Reconexión: si te caes en mitad de una partida, la máquina juega por ti al minuto. Al volver
  con el mismo navegador recuperas tu puesto, porque el identificador vive en `localStorage`.
- No hay reloj de turno ni límite de tiempo.
- Una sala sin humanos se borra sola, así que no se puede montar una partida de cuatro bots para
  verla jugar. Y quien deja su asiento pierde el papel de anfitrión, que pasa al siguiente humano.
