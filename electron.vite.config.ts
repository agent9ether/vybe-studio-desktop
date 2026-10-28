import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { "@shared": resolve(__dirname, "shared") } },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "electron/main/index.ts") } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { "@shared": resolve(__dirname, "shared") } },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "electron/preload/index.ts") },
        // Sandboxed preloads must be a single CommonJS file.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: ".",
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        "@shared": resolve(__dirname, "shared"),
      },
      dedupe: ["react", "react-dom", "@tanstack/react-router"],
    },
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: "src/routes",
        generatedRouteTree: "src/routeTree.gen.ts",
      }),
      react(),
      tailwindcss(),
    ],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "index.html") } },
    },
  },
});
