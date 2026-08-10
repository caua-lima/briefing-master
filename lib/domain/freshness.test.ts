import { describe, expect, it } from "vitest";
import { buildFreshness, computeFreshnessStatus, sanitizeErrorForStorage } from "./freshness";

describe("computeFreshnessStatus", () => {
  it("nunca rodou nenhuma vez é 'unknown', não 'failed' — não inventa uma falha que não aconteceu", () => {
    const s = computeFreshnessStatus({ lastSuccessAt: null, lastAttemptAt: null, lastAttemptFailed: false, staleAfterMinutes: 60 });
    expect(s).toBe("unknown");
  });

  it("só tentativas, nenhum sucesso nunca, é 'failed'", () => {
    const s = computeFreshnessStatus({ lastSuccessAt: null, lastAttemptAt: new Date().toISOString(), lastAttemptFailed: true, staleAfterMinutes: 60 });
    expect(s).toBe("failed");
  });

  it("regra inegociável: teve sucesso ANTES, mas a última tentativa falhou — nunca vira 'sem dado nenhum', é 'failed' com o dado velho ainda disponível", () => {
    const s = computeFreshnessStatus({
      lastSuccessAt: new Date(Date.now() - 5 * 60000).toISOString(),
      lastAttemptAt: new Date().toISOString(),
      lastAttemptFailed: true,
      staleAfterMinutes: 60,
    });
    expect(s).toBe("failed");
  });

  it("sucesso recente e dentro da janela é 'fresh'", () => {
    const s = computeFreshnessStatus({
      lastSuccessAt: new Date(Date.now() - 10 * 60000).toISOString(),
      lastAttemptAt: new Date(Date.now() - 10 * 60000).toISOString(),
      lastAttemptFailed: false,
      staleAfterMinutes: 60,
    });
    expect(s).toBe("fresh");
  });

  it("sucesso mais velho que a janela é 'stale', não 'failed' (dado bom, só desatualizado)", () => {
    const s = computeFreshnessStatus({
      lastSuccessAt: new Date(Date.now() - 120 * 60000).toISOString(),
      lastAttemptAt: new Date(Date.now() - 120 * 60000).toISOString(),
      lastAttemptFailed: false,
      staleAfterMinutes: 60,
    });
    expect(s).toBe("stale");
  });

  it("coverage parcial (processou menos que o esperado) é 'partial', mesmo com sucesso recente", () => {
    const s = computeFreshnessStatus({
      lastSuccessAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
      lastAttemptFailed: false,
      staleAfterMinutes: 60,
      parcial: true,
    });
    expect(s).toBe("partial");
  });
});

describe("buildFreshness", () => {
  it("erro só aparece no resultado quando a ÚLTIMA tentativa falhou — não mantém erro velho de uma falha já superada por um sucesso novo", () => {
    const f = buildFreshness("orders", {
      lastSuccessAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
      lastAttemptFailed: false,
      lastError: "erro de uma tentativa anterior, já resolvida",
      recordsProcessed: 10,
      coverage: null,
      staleAfterMinutes: 60,
    });
    expect(f.lastError).toBeUndefined();
    expect(f.status).toBe("fresh");
  });

  it("com falha na última tentativa, o erro aparece", () => {
    const f = buildFreshness("claims", {
      lastSuccessAt: null,
      lastAttemptAt: new Date().toISOString(),
      lastAttemptFailed: true,
      lastError: "timeout",
      recordsProcessed: null,
      coverage: null,
      staleAfterMinutes: 60,
    });
    expect(f.lastError).toBe("timeout");
    expect(f.status).toBe("failed");
  });
});

describe("sanitizeErrorForStorage — nunca persiste token/payload sensível", () => {
  it("remove Bearer token colado na mensagem de erro", () => {
    const msg = sanitizeErrorForStorage("Falha: Bearer APP_USR-1234567890abcdefghij retornou 401");
    expect(msg).not.toContain("APP_USR-1234567890abcdefghij");
    expect(msg).toContain("[REDACTED]");
  });

  it("remove access_token=... colado na mensagem", () => {
    const msg = sanitizeErrorForStorage("erro ao chamar https://api.mercadolibre.com/x?access_token=abc123XYZ");
    expect(msg).not.toContain("abc123XYZ");
  });

  it("corta em 200 caracteres — nunca persiste payload completo de resposta", () => {
    const enorme = "erro: " + "x".repeat(1000);
    expect(sanitizeErrorForStorage(enorme).length).toBeLessThanOrEqual(200);
  });

  it("mensagem normal e curta passa intacta", () => {
    expect(sanitizeErrorForStorage("Token ML não encontrado")).toBe("Token ML não encontrado");
  });
});
