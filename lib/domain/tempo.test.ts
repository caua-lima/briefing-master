import { describe, expect, it } from "vitest";
import { diaBR, paraBR } from "./tempo";

describe("paraBR", () => {
  it("o caso reportado: ML manda -04:00 e a venda das 13:01 aparecia como 12:01", () => {
    // 12:01 em -04:00 é 13:01 em Brasília (-03:00). Fatiar a string dava
    // "12:01"; converter dá o horário certo, que é o que o ML mostra na tela.
    const r = paraBR("2026-08-15T12:01:00.000-04:00");
    expect(r?.hora).toBe("13:01");
    expect(r?.dia).toBe("2026-08-15");
  });

  it("timestamp que ja vem em -03:00 continua igual", () => {
    expect(paraBR("2026-08-15T13:01:00.000-03:00")?.hora).toBe("13:01");
  });

  it("UTC (Z) converte pra Brasilia", () => {
    expect(paraBR("2026-08-15T16:01:00.000Z")?.hora).toBe("13:01");
  });

  it("vira o DIA quando o offset atravessa a meia-noite", () => {
    // 00:30 UTC de 16/ago = 21:30 de 15/ago em Brasília.
    const r = paraBR("2026-08-16T00:30:00.000Z");
    expect(r?.dia).toBe("2026-08-15");
    expect(r?.hora).toBe("21:30");
  });

  it("meia-noite exata em Brasilia sai como 00:00, nunca 24:00", () => {
    const r = paraBR("2026-08-15T03:00:00.000Z"); // 00:00 BR
    expect(r?.hora).toBe("00:00");
    expect(r?.horaNum).toBe(0);
    expect(r?.dia).toBe("2026-08-15");
  });

  it("sem offset e tratado como horario de Brasilia, nao como UTC do servidor", () => {
    // Sem isto, o Date interpretaria no fuso do servidor (UTC na Vercel) e
    // deslocaria tudo em 3h.
    expect(paraBR("2026-08-15T13:01:00")?.hora).toBe("13:01");
  });

  it("so data devolve o proprio dia, sem inventar hora", () => {
    const r = paraBR("2026-08-15");
    expect(r?.dia).toBe("2026-08-15");
    expect(r?.horaNum).toBe(0);
  });

  it("entrada invalida ou vazia devolve null em vez de data inventada", () => {
    expect(paraBR("")).toBeNull();
    expect(paraBR(null)).toBeNull();
    expect(paraBR("abc")).toBeNull();
    expect(paraBR("2026-13-45T99:99:99Z")).toBeNull();
  });
});

describe("diaBR", () => {
  it("atalho devolve so o dia", () => {
    expect(diaBR("2026-08-15T12:01:00.000-04:00")).toBe("2026-08-15");
  });
  it("invalido vira string vazia, nao quebra quem filtra por data", () => {
    expect(diaBR("xx")).toBe("");
  });
});
