import { describe, expect, it } from "vitest";
import { buildFullColetaAgendadaContent, buildFullColetaRecebidaContent, buildFullDeepLink } from "./notifications";

describe("buildFullDeepLink", () => {
  it("aponta pra aba Full", () => {
    expect(buildFullDeepLink()).toBe("/?tab=full");
  });
});

describe("buildFullColetaAgendadaContent", () => {
  it("inclui produto, quantidade e data formatada", () => {
    const c = buildFullColetaAgendadaContent("Produto X", 40, "2026-08-20");
    expect(c.title).toBe("Coleta agendada pro Full");
    expect(c.body).toBe("Produto X · 40 un · prevista pra 20/08/2026");
  });

  it("sem data agendada, nao quebra e so omite a parte da data", () => {
    const c = buildFullColetaAgendadaContent("Produto X", 40, "");
    expect(c.body).toBe("Produto X · 40 un");
  });
});

describe("buildFullColetaRecebidaContent", () => {
  it("inclui produto e quantidade", () => {
    const c = buildFullColetaRecebidaContent("Produto X", 40);
    expect(c.title).toBe("Coleta recebida no Full");
    expect(c.body).toBe("Produto X · 40 un");
  });
});
