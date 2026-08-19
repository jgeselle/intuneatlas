import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Dev-only convenience: this sandbox's forwarded dev-server URLs come
    // through a *.coder.gsle.ch subdomain — Vite's DNS-rebinding protection
    // blocks unrecognized Host headers by default.
    allowedHosts: [".coder.gsle.ch"],
  },
});
