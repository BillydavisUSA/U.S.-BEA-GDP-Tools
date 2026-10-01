import { defineConfig, loadEnv } from "vite";
import { proxyBeaRequest } from "./server/bea.js";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const beaUserId = process.env.BEA_USER_ID || environment.BEA_USER_ID;
  const beaMiddleware = async (req, res, next) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/api/bea") return next();
    const result = await proxyBeaRequest(new Request(url, { method: req.method }), beaUserId);
    res.writeHead(result.status, Object.fromEntries(result.headers));
    res.end(await result.text());
  };
  return {
    root: "web",
    envDir: process.cwd(),
    base: "./",
    plugins: [{
      name: "bea-server-key",
      configureServer(server) { server.middlewares.use(beaMiddleware); },
      configurePreviewServer(server) { server.middlewares.use(beaMiddleware); },
    }],
    build: { outDir: "../dist-web", emptyOutDir: true },
  };
});
