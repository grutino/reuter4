# Diagnóstico del entrenamiento nocturno

_2026-08-30 21:56:36_

**se acabaron las sesiones.** Mejor marca de la noche: **76.1%** contra el panel.

Confirmada en **76.8%** ±2 sobre partidas que no ha visto ninguna sesión. Esta es la cifra que vale: la marca de la noche es el máximo de muchas medidas ruidosas y está sesgada al alza. Peor rival: `humana-02~1` (4%).

## Cómo fue la noche

| sesión | veredicto | rondas adoptadas | mejor hasta ahí |
|---|---|---|---|
| 1 | 72.7% | 0/1 | 72.7% ← |
| 2 | 74.2% | 0/1 | 72.7% |
| 3 | 76.1% | 0/1 | 76.1% ← |

## Rivales que siguen ganando

| rival | clase | victorias |
|---|---|---|
| humana-02~1 | variante | 4% |
| humana-08 | humana | 57% |
| humana-08~1 | variante | 57% |
| humana-10~1 | variante | 57% |
| humana-07 | humana | 58% |
| humana-10 | humana | 64% |
| humana-11 | humana | 67% |
| humana-07~1 | variante | 70% |

Si uno solo destaca por abajo, el problema es una formación concreta y no el nivel general.

## Rasgos que más mueven la red de despliegue

| rasgo | efecto | sentido |
|---|---|---|
| rangoDeLaBandera | 0.0078 | más es mejor |
| 6·lateral | -0.0057 | menos es mejor |
| 3·cercaDeTiro | -0.0049 | menos es mejor |
| parejasDeDosSaltos | -0.0048 | menos es mejor |
| 2·avance | -0.0042 | menos es mejor |
| 1·cercaDeTiro | 0.0039 | más es mejor |
| 7·cercaDeTiro | -0.0037 | menos es mejor |
| 6·cercaDeTiro | 0.0036 | más es mejor |
| 7·avance | -0.0036 | menos es mejor |
| altosEnPrimeraLinea | 0.0035 | más es mejor |
| 3·avance | -0.0035 | menos es mejor |
| 6·enElBorde | 0.0034 | más es mejor |
| 2·lateral | -0.0034 | menos es mejor |
| 5·lateral | 0.0034 | más es mejor |

### Rasgos planos: 21 de 83

`3·juntoABandera`, `altosCamuflados`, `1·prontoEnJuego`, `4·lateral`, `3·juntoAReclutamiento`, `9·juntoAReclutamiento`, `9·juntoABandera`, `8·enElBorde`, `9·cercaDeTiro`, `8·prontoEnJuego`, `3·lateral`, `equilibrioLateral`, `9·juntoALago`, `8·juntoALago`, `7·juntoALago`, `6·juntoALago`, `5·juntoALago`, `4·juntoALago`, `3·juntoALago`, `2·juntoALago`, `1·juntoALago`

## Qué decidir

- Si hay **rasgos planos**, la red no los usa: o están mal calculados, o no distinguen nada. Podarlos acelera y quita ruido.
- Si **un rasgo domina** al resto, mirar si tapa a los demás; a veces es real y a veces es escala.
- Si **un rival concreto** gana muy por debajo del resto, falta vocabulario para esa situación, no más partidas.
- Si el veredicto **oscila sin subir**, el techo puede ser de la arquitectura: más neuronas ocultas, o dos capas.
- Si **casi ninguna ronda se adopta**, el listón puede estar demasiado alto: bajar `--margen` o subir `--parejasPanel` para medir con menos ruido.

Los bots siguen jugando con lo que hay en `src/motor/modelos/`. Para cambiarlo: `npm run publicar-redes`.
