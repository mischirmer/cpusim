import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The build is deployed to GitHub Pages under /cpusim/, so the production base
// path is absolute "/cpusim/". During development (vite serve) a relative "."
// base keeps asset paths working at the dev-server root.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "serve" ? "./" : "/cpusim/",
}));
