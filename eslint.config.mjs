import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Parâmetro prefixado com "_" é convenção já usada no projeto todo (ex.:
    // lib/firebase/data.ts) pra "assinatura mantida por compatibilidade, mas
    // não usada aqui" — sem isto, só o ÚLTIMO parâmetro não usado de uma
    // função é flagado por padrão (comportamento "after-used" do TS-ESLint),
    // então o mesmo padrão em posições diferentes ficava inconsistente:
    // pego numa função, ignorado em outra, sem relação com o código em si.
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // scripts/*.js são utilitários Node standalone (seed de dados), fora do
    // build do Next — não fazem parte do código ESM/TS do app, então a regra
    // pensada pra isso (no-require-imports) não deveria valer aqui. Escopo
    // restrito só a esta pasta, não desliga a regra pro projeto inteiro.
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
