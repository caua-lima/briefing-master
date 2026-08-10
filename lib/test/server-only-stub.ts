// Stub vazio pra "server-only" nos testes. O pacote real SEMPRE lança erro
// quando importado fora do bundler do Next (ver node_modules/server-only/
// index.js) — o Next só o resolve pra um módulo vazio quando o build é
// server-side, via alias interno do webpack/Turbopack. Vitest não tem essa
// mágica, então precisa do próprio alias (ver vitest.config.ts) apontando
// pra este arquivo, que não faz nada de propósito — é só um marcador.
export {};
