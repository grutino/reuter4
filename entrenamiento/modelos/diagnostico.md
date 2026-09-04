# Diagnóstico del entrenamiento nocturno

_2026-09-04 23:38:02_

**el aprendizaje se ha congelado.** Mejor marca de la noche: **90.5%** contra el panel.

Confirmada en **90.6%** ±2 sobre partidas que no ha visto ninguna sesión. Esta es la cifra que vale: la marca de la noche es el máximo de muchas medidas ruidosas y está sesgada al alza. Peor rival: `humana-02~1` (67%).

## Cómo fue la noche

| sesión | veredicto | rondas adoptadas | mejor hasta ahí |
|---|---|---|---|
| 1 | 90.5% | 0/6 | 90.5% ← |
| 2 | 89.9% | 0/6 | 90.5% |
| 3 | 90.0% | 0/6 | 90.5% |
| 4 | 89.9% | 0/6 | 90.5% |
| 5 | 88.7% | 0/6 | 90.5% |
| 6 | 91.5% | 0/6 | 90.5% |

## Rivales que siguen ganando

| rival | clase | victorias |
|---|---|---|
| humana-02~1 | variante | 67% |
| humana-11~1 | variante | 71% |
| humana-08 | humana | 74% |
| humana-08~1 | variante | 74% |
| humana-09~2 | variante | 74% |
| humana-02 | humana | 77% |
| humana-07 | humana | 82% |
| humana-02~2 | variante | 86% |

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
| posición · banderaEnemigaAlCastillo | -0.1198 | menos es mejor |
| jugada · seAcerca | 0.1075 | más es mejor |
| jugada · seAleja | -0.0605 | menos es mejor |
| jugada · amenazasQueDejo | 0.0550 | más es mejor |
| jugada · tapaLineaAlAnillo | 0.0460 | más es mejor |
| posición · miPiezaMasCerca | 0.0444 | más es mejor |
| jugada · salgoDePeligro | 0.0441 | más es mejor |
| posición · banderaDelSocioAlCastillo | 0.0384 | más es mejor |
| jugada · miRango | 0.0380 | más es mejor |
| jugada · valorEsperadoDelDuelo | 0.0331 | más es mejor |
| jugada · dueloPerdido | -0.0331 | menos es mejor |
| posición · rangosQueLesHeVisto | -0.0312 | menos es mejor |
| jugada · riesgoDeCanonEnDestino | -0.0299 | menos es mejor |
| jugada · canonHaciaElTiro | 0.0283 | más es mejor |

### Rasgos planos: 4 de 75

`jugada · disparoAlCoronador`, `jugada · recapturaAlQueMato`, `jugada · delatoParaSondear`, `jugada · espiaContraMariscal`

## Qué decidir

- Si hay **rasgos planos**, la red no los usa: o están mal calculados, o no distinguen nada. Podarlos acelera y quita ruido.
- Si **un rasgo domina** al resto, mirar si tapa a los demás; a veces es real y a veces es escala.
- Si **un rival concreto** gana muy por debajo del resto, falta vocabulario para esa situación, no más partidas.
- Si el veredicto **oscila sin subir**, el techo puede ser de la arquitectura: más neuronas ocultas, o dos capas.
- Si **casi ninguna ronda se adopta**, el listón puede estar demasiado alto: bajar `--margen` o subir `--parejasPanel` para medir con menos ruido.

Los bots siguen jugando con lo que hay en `src/motor/modelos/`. Para cambiarlo: `npm run publicar-redes`.
