import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Testes de regra exigem emulador do Firestore (e Java) rodando — fora do
    // `npm test`, que precisa passar em qualquer máquina. Rodam por
    // `npm run test:rules`, que sobe o emulador em volta.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.emulator.test.ts"],
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "lib/test/server-only-stub.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
});
