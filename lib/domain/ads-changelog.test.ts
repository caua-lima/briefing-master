import { describe, expect, it } from "vitest";
import { diasDesde, formatarResumoAlteracao } from "./ads-changelog";

describe("formatarResumoAlteracao", () => {
  it("com tipo + antes + depois, monta 'Tipo: antes -> depois'", () => {
    expect(formatarResumoAlteracao({ tipo: "roas_alvo", valorAnterior: "16x", valorNovo: "20x", nota: "" }))
      .toBe("ROAS alvo: 16x → 20x");
  });

  it("com tipo + so depois (primeira vez, sem anterior conhecido)", () => {
    expect(formatarResumoAlteracao({ tipo: "orcamento", valorNovo: "R$ 30/dia", nota: "" }))
      .toBe("Orçamento: R$ 30/dia");
  });

  it("com tipo + so antes (raro, mas nao quebra)", () => {
    expect(formatarResumoAlteracao({ tipo: "status", valorAnterior: "ativa", nota: "" }))
      .toBe("Status (era ativa)");
  });

  it("registro antigo (so nota, sem tipo/valores) cai pro texto livre", () => {
    expect(formatarResumoAlteracao({ nota: "subi o ROAS pra 20x" })).toBe("subi o ROAS pra 20x");
  });

  it("tipo 'outro' usa o mesmo formato dos demais", () => {
    expect(formatarResumoAlteracao({ tipo: "outro", valorNovo: "pausei por 2 dias", nota: "" }))
      .toBe("Outro: pausei por 2 dias");
  });
});

describe("diasDesde", () => {
  it("mesmo instante = 0 dias", () => {
    const agora = 1_700_000_000_000;
    expect(diasDesde(agora, agora)).toBe(0);
  });
  it("exatamente 3 dias depois = 3", () => {
    const createdAt = 1_700_000_000_000;
    expect(diasDesde(createdAt, createdAt + 3 * 86400000)).toBe(3);
  });
  it("nunca retorna negativo mesmo se createdAt vier no futuro por clock skew", () => {
    const agora = 1_700_000_000_000;
    expect(diasDesde(agora + 86400000, agora)).toBe(0);
  });
});
