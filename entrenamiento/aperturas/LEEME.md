# Aperturas del panel de pruebas

Cada fichero `.txt` de esta carpeta es una posición inicial con la que se mide a
los modelos. Se cargan solas: basta con dejar el fichero aquí.

## Formato

Una rejilla de **3 filas por 7 columnas**, en coordenadas de la propia zona. La
misma rejilla vale para los cuatro colores, aunque las zonas norte y sur sean
anchas y las de este y oeste altas.

```
# lo que empiece por # es un comentario
3 1 8 6 9 1 3
5 7 4 . 4 7 5
4 3 6 2 6 5 3
```

- **Fila 1** es la más atrasada, pegada al borde del tablero.
- **Fila 3** es la más adelantada, la que da a la llanura.
- El **punto** del centro de la fila 2 es la casilla de reclutamiento y va vacía.
- La **bandera** la lleva quien ocupe el centro de la fila 1.

## Las veinte piezas

Tienen que estar todas y ninguna de más:

| rango | pieza | cuántas |
|------:|-------|--------:|
| 9 | Mariscal | 1 |
| 8 | General | 1 |
| 7 | Comandante | 2 |
| 6 | Capitán | 3 |
| 5 | Teniente | 3 |
| 4 | Sargento | 3 |
| 3 | Explorador | 4 |
| 2 | Espía | 1 |
| 1 | Cañón | 2 |

Si algo no cuadra, el lector lo dice al cargarla y te enseña qué sobra y qué
falta. No hace falta contar a mano.

## `campeonas/`

Ahí van las aperturas que han batido al panel. Se añaden solas y endurecen la
batería para los modelos siguientes.
