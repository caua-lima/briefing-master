import { describe, expect, it } from "vitest";
import { IDADE_MAX_VENDA_MS, vendaRecente } from "@/lib/ml/notificar-venda";

/**
 * `vendaRecente` é o único guarda entre "avisar a venda" e "não avisar".
 * Errar pra um lado gera silêncio na venda de agora; pro outro, ressuscita
 * venda de semanas atrás como se tivesse acabado de acontecer — e agora que o
 * SYNC também notifica (varrendo o mês inteiro), o segundo risco é real.
 */
describe("vendaRecente", () => {
  const agora = Date.parse("2026-08-20T15:00:00.000Z");
  const iso = (msAtras: number) => new Date(agora - msAtras).toISOString();

  it("venda de agora é recente", () => {
    expect(vendaRecente(iso(0), agora)).toBe(true);
  });

  it("venda de 1h atrás é recente — cobre atraso e retry do ML", () => {
    expect(vendaRecente(iso(3600_000), agora)).toBe(true);
  });

  it("na borda de 12h ainda vale", () => {
    expect(vendaRecente(iso(IDADE_MAX_VENDA_MS), agora)).toBe(true);
  });

  it("1 minuto além da borda já não vale", () => {
    expect(vendaRecente(iso(IDADE_MAX_VENDA_MS + 60_000), agora)).toBe(false);
  });

  it("venda de ontem NÃO é notificada", () => {
    // O sync varre o mês inteiro; sem isto, cada sync viraria uma enxurrada
    // de avisos de vendas antigas.
    expect(vendaRecente(iso(24 * 3600_000), agora)).toBe(false);
  });

  it("data no futuro conta como recente — relógio torto não pode silenciar venda", () => {
    expect(vendaRecente(new Date(agora + 60_000).toISOString(), agora)).toBe(true);
  });

  it("data ilegível NÃO notifica — sem data não dá pra afirmar que é de agora", () => {
    expect(vendaRecente("", agora)).toBe(false);
    expect(vendaRecente("sem data", agora)).toBe(false);
  });

  it("aceita offset diferente de UTC — o instante é o que importa", () => {
    // 12:00 em -03:00 é 15:00Z: mesmo instante de `agora`.
    expect(vendaRecente("2026-08-20T12:00:00.000-03:00", agora)).toBe(true);
  });
});
