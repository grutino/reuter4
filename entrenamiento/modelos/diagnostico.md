# Diagnóstico del entrenamiento nocturno

_2026-09-04 04:20:21_

**el aprendizaje se ha congelado.** Mejor marca de la noche: **90.3%** contra el panel.

Confirmada en **85.9%** ±2 sobre partidas que no ha visto ninguna sesión. Esta es la cifra que vale: la marca de la noche es el máximo de muchas medidas ruidosas y está sesgada al alza. Peor rival: `humana-08` (38%).

## Cómo fue la noche

| sesión | veredicto | rondas adoptadas | mejor hasta ahí |
|---|---|---|---|
| 1 | 84.8% | 1/6 | 84.8% ← |
| 2 | 85.8% | 0/6 | 84.8% |
| 3 | 85.1% | 0/6 | 84.8% |
| 4 | 90.3% | 2/6 | 90.3% ← |
| 5 | 87.0% | 2/6 | 90.3% |
| 6 | 85.5% | 1/6 | 90.3% |
| 7 | 85.6% | 0/6 | 90.3% |
| 8 | 85.7% | 1/6 | 90.3% |
| 9 | 88.6% | 1/6 | 90.3% |

## Rivales que siguen ganando

| rival | clase | victorias |
|---|---|---|
| humana-08 | humana | 38% |
| humana-08~1 | variante | 38% |
| humana-09 | humana | 52% |
| humana-02 | humana | 67% |
| humana-07 | humana | 68% |
| humana-02~1 | variante | 76% |
| humana-03~2 | variante | 76% |
| humana-11~1 | variante | 78% |

Si uno solo destaca por abajo, el problema es una formación concreta y no el nivel general.

## Rasgos que más mueven la red de despliegue

| rasgo | efecto | sentido |
|---|---|---|
| 1 Cañón · cubiertoPorLago | 0.0164 | más es mejor |
| conjunto · rangoDeLaBandera | 0.0163 | más es mejor |
| 1 Cañón · lateral | -0.0132 | menos es mejor |
| 9 Mariscal · cubiertoPorLago | -0.0112 | menos es mejor |
| 1 Cañón · cercaDeTiro | 0.0110 | más es mejor |
| 4 Sargento · cercaDeTiro | -0.0094 | menos es mejor |
| 1 Cañón · juntoABandera | -0.0093 | menos es mejor |
| 5 Teniente · cercaDeTiro | -0.0091 | menos es mejor |
| 2 Espía · cubiertoPorLago | -0.0084 | menos es mejor |
| 4 Sargento · avance | -0.0081 | menos es mejor |
| 6 Capitán · juntoAReclutamiento | -0.0076 | menos es mejor |
| 5 Teniente · juntoAReclutamiento | -0.0069 | menos es mejor |
| 6 Capitán · cercaDeTiro | 0.0065 | más es mejor |
| conjunto · altosEnPrimeraLinea | 0.0064 | más es mejor |

### Rasgos planos: 10 de 83

`conjunto · equilibrioLateral`, `6 Capitán · prontoEnJuego`, `3 Explorador · lateral`, `conjunto · defensaEconomica`, `8 General · cercaDeTiro`, `3 Explorador · juntoAReclutamiento`, `1 Cañón · juntoAReclutamiento`, `9 Mariscal · lateral`, `7 Comandante · juntoABandera`, `9 Mariscal · juntoABandera`

## Rasgos que más mueven la red de jugada

| rasgo | efecto | sentido |
|---|---|---|
| posición · banderaEnemigaAlCastillo | -0.1629 | menos es mejor |
| jugada · seAcerca | 0.1496 | más es mejor |
| jugada · seAleja | -0.0955 | menos es mejor |
| jugada · amenazasQueDejo | 0.0855 | más es mejor |
| posición · miPiezaMasCerca | 0.0564 | más es mejor |
| jugada · salgoDePeligro | 0.0558 | más es mejor |
| jugada · riesgoDeCanonEnDestino | -0.0492 | menos es mejor |
| jugada · tapaLineaAlAnillo | 0.0483 | más es mejor |
| jugada · pisaBanderaSuelta | 0.0466 | más es mejor |
| posición · banderaDelSocioAlCastillo | 0.0451 | más es mejor |
| jugada · anilloCubiertoTrasJugar | 0.0402 | más es mejor |
| posición · avanceDeLaPartida | 0.0310 | más es mejor |
| jugada · canonHaciaElTiro | 0.0306 | más es mejor |
| jugada · miRango | 0.0275 | más es mejor |

### Rasgos planos: 1 de 75

`posición · miEspiaVivo`

## Qué decidir

- Si hay **rasgos planos**, la red no los usa: o están mal calculados, o no distinguen nada. Podarlos acelera y quita ruido.
- Si **un rasgo domina** al resto, mirar si tapa a los demás; a veces es real y a veces es escala.
- Si **un rival concreto** gana muy por debajo del resto, falta vocabulario para esa situación, no más partidas.
- Si el veredicto **oscila sin subir**, el techo puede ser de la arquitectura: más neuronas ocultas, o dos capas.
- Si **casi ninguna ronda se adopta**, el listón puede estar demasiado alto: bajar `--margen` o subir `--parejasPanel` para medir con menos ruido.

Los bots siguen jugando con lo que hay en `src/motor/modelos/`. Para cambiarlo: `npm run publicar-redes`.
