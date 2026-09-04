import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
      // El taller lo sirve el servidor del juego, no Vite. Sin este proxy, el
      // botón "Valorar para el entrenamiento" abría /juicios en el puerto de
      // Vite, que no conoce esa ruta y devuelve el index del juego: parecía el
      // taller pero era otra página, sin el estado de las redes ni las partidas
      // por cosechar.
      "/juicios": { target: "http://localhost:8080" },
      // Y los modelos, que la página del informe de partida pide al servidor.
      "/modelos": { target: "http://localhost:8080" },
    },
  },
});
