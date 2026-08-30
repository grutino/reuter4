// El genoma: qué pesos se entrenan y en qué unidades vive cada uno.
//
// Vive en su propio módulo porque lo necesitan tanto el entrenador como el
// informe, y si el informe importaba del entrenador se montaba una importación
// circular que, de paso, lanzaba un entrenamiento con solo pedir el informe.

export const CORONAR = 10000;

// La escala dice en qué orden de magnitud vive cada peso, no qué valor le
// conviene. Los términos que se suman tal cual van en centenas; los que
// multiplican un rango (1 a 9) o una distancia van en decenas.
export const ESCALAS = {
  ruido: 6,
  avanceConBandera: 20,
  primaPortador: 30,
  avanceNormal: 20,
  banderaSuelta: 100,
  amenazaBase: 30,
  amenazaFactor: 10,
  disparoConocidoBase: 100,
  disparoConocidoFactor: 15,
  disparoDesconocido: 100,
  disparoABandera: 100,
  ataqueGanaBase: 100,
  ataqueGanaFactor: 15,
  ataqueEmpate: 100,
  ataquePierde: 200,
  espiaAMariscal: 150,
  ataqueDesconocido: 10,
  ataqueABandera: 150,
  portadorNoPelea: 150,
  ataqueAlCastillo: 100,
};

export const GENES = Object.keys(ESCALAS);

export function pesosDesdeGenes(genes) {
  const pesos = { coronar: CORONAR };
  GENES.forEach((k, i) => {
    pesos[k] = genes[i] * ESCALAS[k];
  });
  // El ruido es un desempate, no puede ser negativo.
  pesos.ruido = Math.abs(pesos.ruido);
  return pesos;
}

export function genesDesdePesos(pesos) {
  return GENES.map((k) => pesos[k] / ESCALAS[k]);
}

