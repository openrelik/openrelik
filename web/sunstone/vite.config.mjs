// Plugins
import Fonts from "unplugin-fonts/vite";
import Vue from "@vitejs/plugin-vue";
import Vuetify, { transformAssetUrls } from "vite-plugin-vuetify";

// Utilities
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

// https://vitejs.dev/config/
const hmrClientPort = Number(process.env.VITE_HMR_CLIENT_PORT);

export default defineConfig({
  plugins: [
    Vue({
      template: { transformAssetUrls },
    }),
    // https://github.com/vuetifyjs/vuetify-loader/tree/master/packages/vite-plugin#readme
    Vuetify({
      autoImport: true,
      styles: {
        configFile: "src/styles/settings.scss",
      },
    }),
    Fonts({
      google: {
        families: [
          {
            name: "Roboto",
            styles: "wght@100;300;400;500;700;900",
          },
        ],
      },
    }),
  ],
  define: { "process.env": {} },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    extensions: [".js", ".json", ".jsx", ".mjs", ".ts", ".tsx", ".vue"],
  },
  build: {
    assetsDir: "assets/sunstone",
  },
  server: {
    port: 3000,
    ...(Number.isInteger(hmrClientPort) && hmrClientPort > 0
      ? { hmr: { clientPort: hmrClientPort } }
      : {}),
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern",
      },
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./happydom.config.js"],
    server: {
      deps: {
        inline: ["vuetify"],
      },
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{js,vue}"],
      reporter: ["text", "json", "html", "lcov"],
    },
    onConsoleLog(log) {
      if (log.includes("AbortError")) return false;
      if (log.includes("The operation was aborted")) return false;
      if (log.includes("SSE request failed: Unauthorized")) return false;
    },
  },
});
