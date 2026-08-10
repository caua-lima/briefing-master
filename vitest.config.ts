import { defineConfig } from "vitest/config";
import path from "node:path";

// Testes ficam ao lado do código que testam (*.test.ts), não numa pasta
// __tests__ separada — mais fácil de achar/manter perto da fonte da verdade.
// Ambiente "node" (não jsdom): o alvo inicial (Fase 9) é lógica de domínio
// pura — cálculo financeiro, classificação de venda, permissão — nada disso
// toca DOM. Componente React fica pra quando/se testarmos renderização.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      // Espelha o "@/*": ["./*"] do tsconfig.json — sem isso, os testes não
      // resolveriam nenhum import "@/lib/..." igual ao resto do projeto.
      "@": path.resolve(__dirname, "."),
      // O pacote real "server-only" sempre lança erro fora do bundler do
      // Next (é assim que ele impede código servidor de vazar pro client) —
      // aqui redireciona pra um stub vazio, mesmo papel que o alias interno
      // do Next faz em build server-side. Ver lib/test/server-only-stub.ts.
      "server-only": path.resolve(__dirname, "lib/test/server-only-stub.ts"),
    },
  },
});
