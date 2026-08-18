import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Config SÓ dos testes de Security Rules (*.emulator.test.ts).
 *
 * Separado do vitest.config.ts porque estes exigem o emulador do Firestore
 * de pé — e o `npm test` precisa passar em qualquer máquina, inclusive sem
 * Java. Quem roda isto é o `npm run test:rules`, que sobe o emulador em volta.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.emulator.test.ts"],
    // O emulador é um recurso compartilhado: dois arquivos em paralelo
    // limpariam o Firestore um do outro no meio do teste do vizinho.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "lib/test/server-only-stub.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
});
