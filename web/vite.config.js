import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Dev-only convenience: this sandbox's forwarded dev-server URLs come
    // through a *.coder.gsle.ch subdomain — Vite's DNS-rebinding protection
    // blocks unrecognized Host headers by default.
    allowedHosts: [".coder.gsle.ch"],
    // The UI decides what to offer with the server's own permission rule (src/lib/permissions.ts), so the
    // dev server has to serve that one file from the CLI's source next door.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), "../src/auth/roles.ts"] },
  },
});
