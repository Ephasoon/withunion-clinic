import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In development the browser only ever talks to the Vite server
// (http://localhost:5173). Requests to /api and /health are proxied to
// the backend, so the session cookie stays first-party and no CORS is
// involved. Production is expected to serve the app and API from one
// origin as well (see nginx/), so the client uses relative URLs.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://localhost:4000";

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: false },
        "/health": { target: apiTarget, changeOrigin: false },
      },
    },
  };
});
