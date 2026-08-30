// Los colores de los cuatro ejércitos y los nombres de los rangos.
//
// En su propio módulo porque los usan el tablero 3D, la ventana de combate y el
// informe de fin de partida. Estaban en Tablero3D.jsx, y eso obligaba al informe
// a importar three.js entero para saber de qué color es el ejército rojo —lo que
// además lo hacía imposible de probar fuera del navegador.

export const ESTILO = {
  rojo: { hex: 0xa8322c, css: "#A8322C", lado: "Norte" },
  verde: { hex: 0x3a7a4a, css: "#3A7A4A", lado: "Este" },
  azul: { hex: 0x33589b, css: "#33589B", lado: "Sur" },
  amarillo: { hex: 0xc89b24, css: "#C89B24", lado: "Oeste" },
};

export const NOMBRE_RANGO = {
  9: "Mariscal", 8: "General", 7: "Comandante", 6: "Capitán", 5: "Teniente",
  4: "Sargento", 3: "Explorador", 2: "Espía", 1: "Cañón",
};

