import { describe, expect, it } from "vitest";
import { diaBRDe, recortarPorDiaBR } from "./periodo-br";

describe("diaBRDe — o dia é o de Brasília, não o da string", () => {
  it("22h de 31/07 em BR é 31/07, não 01/08", () => {
    // O caso que jogava faturamento pro mês errado na virada.
    expect(diaBRDe("2026-07-31T22:14:03.000-03:00")).toBe("2026-07-31");
  });

  it("mesmo instante escrito em UTC dá o mesmo dia BR", () => {
    // 2026-08-01T01:14Z === 2026-07-31T22:14-03:00
    expect(diaBRDe("2026-08-01T01:14:03.000Z")).toBe("2026-07-31");
  });

  it("00:30 UTC do dia 1 ainda é dia 31 em Brasília", () => {
    expect(diaBRDe("2026-08-01T00:30:00.000Z")).toBe("2026-07-31");
  });

  it("03:00 UTC do dia 1 já é dia 1 em Brasília (meia-noite cravada)", () => {
    expect(diaBRDe("2026-08-01T03:00:00.000Z")).toBe("2026-08-01");
  });

  it("offset diferente de -03:00 é convertido, não copiado", () => {
    // -04:00 (Manaus/Cuiabá no verão de outros anos, ou dado do ML): 23h lá
    // é meia-noite em Brasília, ou seja, já o dia seguinte.
    expect(diaBRDe("2026-08-01T23:30:00.000-04:00")).toBe("2026-08-02");
  });

  it("data ilegível cai pro corte cru, sem quebrar nem sumir", () => {
    expect(diaBRDe("sem data")).toBe("sem data");
    expect(diaBRDe("")).toBe("");
  });
});

describe("recortarPorDiaBR — o corte que faz o total bater com o Seller Center", () => {
  const pedidos = [
    { id: "a", date_created: "2026-07-31T22:14:03.000-03:00" }, // véspera: fora
    { id: "b", date_created: "2026-08-01T00:05:00.000-03:00" }, // 1º minuto: dentro
    { id: "c", date_created: "2026-08-15T12:00:00.000-03:00" }, // meio: dentro
    { id: "d", date_created: "2026-08-31T23:59:00.000-03:00" }, // último minuto: dentro
    { id: "e", date_created: "2026-09-01T00:10:00.000-03:00" }, // dia seguinte: fora
  ];

  it("mantém só o que cai no período e conta o resto", () => {
    const { dentro, foraDaJanela } = recortarPorDiaBR(pedidos, "2026-08-01", "2026-08-31");
    expect(dentro.map((p) => p.id)).toEqual(["b", "c", "d"]);
    expect(foraDaJanela).toBe(2);
  });

  it("descarta a sobra de 3h que a união UTC+BR arrastava", () => {
    // Este pedido só aparecia por causa da janela UTC do fallback: 00:30Z do
    // dia 1 ainda é 31/07 às 21:30 em Brasília.
    const { dentro, foraDaJanela } = recortarPorDiaBR(
      [{ date_created: "2026-08-01T00:30:00.000Z" }], "2026-08-01", "2026-08-31",
    );
    expect(dentro).toHaveLength(0);
    expect(foraDaJanela).toBe(1);
  });

  it("período de um dia só inclui exatamente aquele dia", () => {
    const { dentro } = recortarPorDiaBR(pedidos, "2026-08-15", "2026-08-15");
    expect(dentro.map((p) => p.id)).toEqual(["c"]);
  });

  it("lista vazia não quebra", () => {
    expect(recortarPorDiaBR([], "2026-08-01", "2026-08-31")).toEqual({ dentro: [], foraDaJanela: 0 });
  });

  it("pedido sem data não entra no período — não dá pra afirmar que pertence", () => {
    const { dentro, foraDaJanela } = recortarPorDiaBR([{ date_created: undefined }], "2026-08-01", "2026-08-31");
    expect(dentro).toHaveLength(0);
    expect(foraDaJanela).toBe(1);
  });
});
