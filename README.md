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
src/            cliente React con el tablero en three.js
servidor/       servidor Node con WebSocket: guarda el estado y mueve los bots
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
npm test          # 60 pruebas del motor
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

Los bots recuerdan lo que han visto. Cuando alguien sobrevive a un duelo, su rango queda a la
vista de toda la mesa; lo mismo ocurre cuando una pieza se delata sola, porque solo el
explorador recorre más de una casilla en línea y solo el capitán encadena dos con giro. El
motor lo va anotando en `rangosRevelados` y los bots deciden con eso: van a por la captura
segura, no se estrellan contra un rango que ya saben mayor, y sueltan el espía sobre el
mariscal en cuanto lo tienen fichado. Contra un desconocido no adivinan: calculan el valor
esperado del duelo con lo que aún puede quedarle escondido al rival.

Solo miran información pública. Corren dentro del servidor, con el estado completo delante,
pero no leen el rango oculto de ninguna pieza ajena: hay una prueba que lo comprueba montando
dos escenarios que solo se diferencian en ese rango escondido y exigiendo que el bot juegue
igual en los dos.

Medido con `npm run simular` sobre 2000 partidas con los bandos alternados, los bots con
memoria ganan el 65% de las partidas decididas frente a los antiguos.

## Qué falta por pulir

- **El informe de seguimiento del entrenamiento sobra por la mitad**: hoy arrastra curvas del
  evolutivo de pesos y de la heurística, que ya no se usan para nada. Debe quedarse solo con lo
  que dice algo de la **calidad de las dos redes**: curvas de aprendizaje y validación,
  calibración, histograma de predicciones, sensibilidad por rasgo —falta la de la red de jugada,
  que solo existe para la de despliegue—, la curva de coevolución titular contra aspirante, y el
  desglose rival a rival del panel.
- **El informe de fin de partida debe llevar el análisis, no solo el relato**: ahora cuenta lo
  que pasó (despliegues, flechas, hilo). Falta lo que se saca de analizarlo: qué jugadas fueron
  determinantes, dónde se perdió o se ganó la partida, y la valoración de cada bando. Es la
  misma maquinaria del detector en dos etapas, presentada para leerla.

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
  dibujo interior se graba; los valores por defecto se eligieron mirando las nueve fichas a
  tamaño real. Si cambias de foto, míralas a 46 px antes de dar nada por bueno: a ese tamaño
  lo único que distingue un rango de otro es el contorno.
- **Tácticas que aún no tienen rasgo**: atacar por zonas donde la bolsa de rangos ocultos nos
  favorece, el señuelo del espía, explorador a distancia para revelar, bloquear los laterales,
  sacrificio para promocionar con el marcador alto, defender la bandera propia, cuidar los rangos
  altos, controlar el anillo — y cada una con su pareja defensiva. Ya están hechas: cañones tras
  los lagos (`cubiertoPorLago`), batir el castillo y al que va a coronar, llevar el cañón a
  posición, y tapar la línea de tiro rival.

  **Antes de añadir ninguna, leer el aviso de la cobertura del anillo**: un rasgo que se activa
  en el 0,2% de los ejemplos no aporta gradiente y la red lo ignora. Añadir tácticas raras sin
  resolver antes el muestreo es trabajo que no se aprende.
- **El evolutivo se diluye al crecer el genoma**: con 26 genes rinde peor que con 20 a igualdad
  de presupuesto. Cada peso nuevo reparte la misma presión selectiva entre más candidatos, y
  `npm run revisar` enseña el desequilibrio: `avanceNormal` se activa 26.000 veces por cada mil
  jugadas y `espiaAMariscal` ninguna. En una red los rasgos son entradas que comparten gradiente
  en vez de pesos que compiten, que es la salida natural a esto.
- **Mejora visual del tablero 3D**: texturas de verdad, materiales, iluminación. Hoy todo son
  colores planos con `MeshLambertMaterial` y las fichas son discos con una silueta pegada.
- Reconexión: si te caes en mitad de una partida, la máquina juega por ti al minuto. Al volver
  con el mismo navegador recuperas tu puesto, porque el identificador vive en `localStorage`.
- No hay reloj de turno ni límite de tiempo.
