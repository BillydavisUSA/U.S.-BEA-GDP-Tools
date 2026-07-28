import { defineConfig } from "vite";

const beaProxy = {
  target: "https://apps.bea.gov",
  changeOrigin: true,
  secure: true,
  rewrite: (requestPath) => requestPath.replace(/^\/api\/bea/u, "/api/data/"),
};

export default defineConfig({
  base: "./",
  server: {
    proxy: {
      "/api/bea": beaProxy,
    },
  },
  preview: {
    proxy: {
      "/api/bea": beaProxy,
    },
  },
});
