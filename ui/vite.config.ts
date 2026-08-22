import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const hardenedTransportProxy = (): ProxyOptions => ({
  target: "http://127.0.0.1:3000",
  changeOrigin: true,
  configure(proxy) {
    proxy.on("proxyReq", (proxyRequest) => {
      // This is a same-host transport hop, not a second trust boundary. The
      // browser's Vite Origin would otherwise fail the Next API's same-origin
      // check after changeOrigin rewrites Host to the hardened service.
      proxyRequest.removeHeader("origin");
    });
  },
});

export default defineConfig({
  plugins: [react()],
  // These proxies are transport only: the browser reaches one local origin,
  // while the hardened Next API remains the gym/auth authority. No provider
  // credentials or trusted headers belong in this UI configuration.
  //
  // Cookie and Set-Cookie headers intentionally use http-proxy's untouched
  // defaults; do not add cookieDomainRewrite/cookiePathRewrite here.
  //
  // The legacy bridge remains responsible only for profile, lesson, and media
  // routes during migration. Specific hardened routes must stay before /api.
  server: {
    // Bind IPv4 loopback explicitly. Vite's default "localhost" resolves to
    // ::1 on this host, so an `ssh -L 5173:127.0.0.1:5173` tunnel is refused.
    host: "127.0.0.1",
    proxy: {
      "/api/auth/access": hardenedTransportProxy(),
      "/api/gym": hardenedTransportProxy(),
      "/api": "http://127.0.0.1:8787",
      "/media": "http://127.0.0.1:8787",
    },
  },
  preview: {
    host: "127.0.0.1",
    proxy: {
      "/api/auth/access": hardenedTransportProxy(),
      "/api/gym": hardenedTransportProxy(),
      "/api": "http://127.0.0.1:8787",
      "/media": "http://127.0.0.1:8787",
    },
  },
});
