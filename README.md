# Stratego 4

Versión digital del Stratego 4 de Jumbo: cuatro ejércitos en dos bandos, tablero en 3D
y partidas online. Rojo y Azul contra Verde y Amarillo, cada jugador enfrente de su compañero.
Gana el bando que corone cualquiera de sus dos banderas en la torre del castillo.

## Qué hay dentro

```
src/motor/      reglas puras, sin interfaz: tablero, motor, pruebas y simulación
src/            cliente React con el tablero en three.js
servidor/       servidor Node con WebSocket: guarda el estado y mueve los bots
```

El servidor es la autoridad. Los clientes solo reciben los rangos de sus propias piezas,
así que ningún jugador puede espiar las del rival mirando el navegador.

## Requisitos

Node 18 o superior.

## Poner en marcha

```bash
npm install
npm test          # 43 pruebas del motor
npm run simular   # 25 partidas de bots, para ver que nada se atasca
```

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
- `S4_ESTADO`: fichero donde se guardan las salas, `servidor/salas.json` por defecto.

## Publicarlo en internet

**Importante**: GitHub Pages, Netlify y similares solo sirven ficheros estáticos, así que
por sí solos no valen: este juego necesita un proceso Node vivo para el WebSocket. Tienes
dos caminos.

### Opción A: plataforma de aplicaciones (lo más rápido)

En Render, Railway, Fly.io o similar, crea un servicio web de tipo Node apuntando a este
repositorio, con:

- comando de construcción: `npm install && npm run build`
- comando de arranque: `npm run servidor`

La plataforma inyecta `PORT` y termina el HTTPS por ti, así que el cliente hablará por `wss://`
automáticamente. Ten en cuenta que en los planes gratuitos el disco suele ser efímero: las
salas guardadas en `salas.json` se pierden al reiniciar. Para partidas de una tarde da igual.

### Opción B: tu propio servidor con nginx

```bash
git clone TU_REPOSITORIO stratego4 && cd stratego4
npm install && npm run build
```

Servicio de systemd en `/etc/systemd/system/stratego4.service`:

```ini
[Unit]
Description=Stratego 4
After=network.target

[Service]
WorkingDirectory=/ruta/a/stratego4
ExecStart=/usr/bin/node servidor/servidor.mjs
Environment=PORT=8080
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now stratego4
```

Y en nginx, un bloque que pase también la conexión WebSocket:

```nginx
server {
    server_name stratego.tudominio.com;

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
git commit -m "Stratego 4: motor, servidor y cliente 3D"
git branch -M main
git remote add origin git@github.com:TU_USUARIO/stratego4.git
git push -u origin main
```

`node_modules/`, `dist/` y `servidor/salas.json` ya están en `.gitignore`.

## Qué falta por pulir

- Reconexión: si te caes en mitad de una partida, la máquina juega por ti al minuto. Al volver
  con el mismo navegador recuperas tu puesto, porque el identificador vive en `localStorage`.
- No hay reloj de turno ni límite de tiempo.
- Los bots juegan de forma razonable pero no llevan memoria de los rangos ya revelados, que es
  justo lo que más diferencia a un buen jugador humano.
