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

- **Simplificar el informe de las redes: solo métricas de las dos redes y cómo mejoran**. Hoy
  mezcla la coevolución, el panel y las redes, y de las redes enseña sobre todo el ÚLTIMO
  entrenamiento. Lo que hace falta es ver la evolución: cómo cambian entre rondas y dentro de
  cada una.

  Ya se guarda por ronda y por red, en `modelos/coevolucion.json`: pérdida de validación,
  acierto, `epocasUtiles` —en qué época se dejó de mejorar, que es la señal directa de
  sobreajuste—, calibración en diez cubos, y la curva de pérdida por época (entrenamiento y
  validación). También `perdidaDePartida`, o sea de dónde arrancaba la red vigente.

  Falta registrar: **acierto por época** (solo hay pérdida por época) y **acierto de
  entrenamiento** (solo hay el de validación). Sin esos dos no se puede pintar la pareja de
  curvas que de verdad enseña el sobreajuste — la de entrenamiento subiendo mientras la de
  validación se estanca.

  Y falta pintarlo: hoy solo se dibuja la curva de la última ronda. Debería verse la serie
  **entre** rondas —pérdida, acierto y época útil ronda a ronda— junto a las curvas **dentro**
  de la ronda. Lo demás (coevolución, rival a rival) puede irse a otra página o abajo del todo.

- **Un solo informe de partida, no dos**: hoy hay un botón para el relato y otro para el
  análisis. Debería ser uno con todo, y las jugadas determinantes no en un bloque aparte sino
  **sobre el hilo que ya existe**: fondo verde suave si la jugada fue buena, rojo suave si fue
  mala, con la evaluación que ya se calcula. El hilo es la línea de tiempo natural de la
  partida; duplicarla en una tabla al lado obliga a leer dos veces lo mismo.
- **Un cañonazo sobre un explorador es tirar el cañón**: se ha visto en partida. El disparo se
  valora por el rango del objetivo (`disparoConocidoBase + rango x factor`) pero no descuenta lo
  que vale el cañón que se gasta, así que batir a un explorador ya identificado —41 puntos—
  sale a cuenta cuando no debería. Hace falta un suelo: por debajo de cierto rango, no compensa
  gastar la pieza. Ojo al medirlo, que subir pesos de cañón ya costó bajar del 52% al 37% una vez.

- **Medir el impacto de UNA jugada es muy ruidoso, y eso condiciona el análisis**: con tiradas
  estocásticas, la misma posición medida dos veces con 8 tiradas solo correlaciona **0,39**
  consigo misma, y dos medidas difieren de media 5 puntos sobre un recorrido de 35. Eso pone un
  techo a cualquier detector barato: ninguna señal puede predecir mejor de lo que la medida se
  predice a sí misma. Consecuencia práctica: no se pueden **ordenar** las jugadas de una partida
  por importancia sin gastar decenas de tiradas por jugada, pero sí se puede aprender del
  **agregado** de muchas posiciones con pocas tiradas cada una, que es lo que hace el banco de
  escenarios. Para elegir qué posiciones merecen un juicio humano conviene un criterio robusto
  (situaciones raras, finales cerca del castillo) antes que la estimación de impacto.
- **Entrenar con escenarios concretos, no solo partidas enteras**: hoy los ejemplos salen de
  partidas jugadas de principio a fin, y eso deja las tácticas decisivas sin aprender por pura
  rareza. Medido sobre 3.420 vectores de jugada: `tapaLineaAlAnillo` se activa en el 0,1% de los
  casos y `disparoAlCoronador` en ninguno. Un rasgo que aparece en el 0,2% de los ejemplos no
  aporta gradiente y la red lo ignora. La vía es sacar posiciones de los **historiales de
  partidas terminadas** —que el informe ya reconstruye entera, con el rango de cada jugada— para
  identificar dónde se pierde y sobremuestrear esas situaciones: finales cerca del castillo,
  coronaciones falladas, cañonazos decisivos. Mientras tanto esas tácticas viven en la
  heurística, con pesos deterministas, que ahí sí funcionan.

- **Las siluetas salen de una foto**: `herramientas/extraer-siluetas.py` convierte una foto de
  la tarjeta de referencia en las máscaras de `src/siluetas-datos.js`. La foto no se versiona,
  solo la silueta derivada. Para rehacerlas con otra foto mejor:

  ```bash
  python3 herramientas/extraer-siluetas.py TU_FOTO.png > src/siluetas-datos.js
  ```

  Los parámetros `--cierre` y `--umbral` gobiernan cuánto se macizan las figuras y cuánto
  dibujo interior se graba. **Míralas a 46 px antes de dar nada por bueno**, que es el tamaño
  real en el tablero: a ese tamaño la silueta sola no basta —está medido— y por eso la ficha
  lleva además el galón.
- **Tácticas que aún no tienen rasgo**: atacar por zonas donde la bolsa de rangos ocultos nos
  favorece, el señuelo del espía, explorador a distancia para revelar, bloquear los laterales,
  sacrificio para promocionar con el marcador alto, defender la bandera propia, cuidar los rangos
  altos, controlar el anillo — y cada una con su pareja defensiva. Ya están hechas: cañones tras
  los lagos (`cubiertoPorLago`), batir el castillo y al que va a coronar, llevar el cañón a
  posición, y tapar la línea de tiro rival.

  **Antes de añadir ninguna, leer el aviso de la cobertura del anillo**: un rasgo que se activa
  en el 0,2% de los ejemplos no aporta gradiente y la red lo ignora. Añadir tácticas raras sin
  resolver antes el muestreo es trabajo que no se aprende.
- Reconexión: si te caes en mitad de una partida, la máquina juega por ti al minuto. Al volver
  con el mismo navegador recuperas tu puesto, porque el identificador vive en `localStorage`.
- No hay reloj de turno ni límite de tiempo.
