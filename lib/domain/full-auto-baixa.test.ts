import { describe, expect, it } from "vitest";
import { podeBaixarAutomatico, separarParaAutoBaixa } from "./full-auto-baixa";
import type { Remessa } from "./remessas";

function remessa(over: Partial<Remessa> = {}): Remessa {
  return {
    remessa: "111", data: "2026-08-10", recebido: 100, problema: 0, saldoFull: 100,
    tipos: [], refs: [], ehTransferencia: false,
    produtos: [{ inventory: "INV1", nome: "Erva", cadastrado: true, productId: "p1", qtd: 100 }],
    ...over,
  };
}

describe("podeBaixarAutomatico", () => {
  it("remessa limpa e cadastrada pode ser aplicada sozinha", () => {
    expect(podeBaixarAutomatico(remessa())).toEqual({ pode: true });
  });

  it("transferencia entre centros nunca da baixa — descontaria duas vezes", () => {
    const d = podeBaixarAutomatico(remessa({ ehTransferencia: true }));
    expect(d.pode).toBe(false);
  });

  it("divergencia bloqueia: e prejuizo e o numero a baixar nao e obvio", () => {
    const d = podeBaixarAutomatico(remessa({ problema: 3 }));
    expect(d.pode).toBe(false);
    if (!d.pode) expect(d.motivo).toContain("divergência");
  });

  it("produto sem cadastro bloqueia — nao ha de quem descontar", () => {
    const d = podeBaixarAutomatico(remessa({
      produtos: [
        { inventory: "INV1", nome: "Erva", cadastrado: true, productId: "p1", qtd: 50 },
        { inventory: "INV2", nome: "", cadastrado: false, productId: "", qtd: 50 },
      ],
    }));
    expect(d.pode).toBe(false);
    if (!d.pode) expect(d.motivo).toContain("sem cadastro");
  });

  it("sem unidades recebidas nao ha o que lancar", () => {
    expect(podeBaixarAutomatico(remessa({ recebido: 0 })).pode).toBe(false);
  });

  it("remessa sem produtos identificados bloqueia", () => {
    expect(podeBaixarAutomatico(remessa({ produtos: [] })).pode).toBe(false);
  });
});

describe("separarParaAutoBaixa", () => {
  const nunca = () => false;

  it("separa automatica de manual", () => {
    const r = separarParaAutoBaixa(
      [remessa({ remessa: "ok" }), remessa({ remessa: "ruim", problema: 2 })],
      nunca,
    );
    expect(r.automaticas.map((x) => x.remessa)).toEqual(["ok"]);
    expect(r.manuais.map((x) => x.remessa.remessa)).toEqual(["ruim"]);
  });

  it("remessa ja resolvida sai das duas listas", () => {
    const r = separarParaAutoBaixa([remessa({ remessa: "ok" })], () => true);
    expect(r.automaticas).toHaveLength(0);
    expect(r.manuais).toHaveLength(0);
  });

  it("transferencia nao vira pendencia manual — ninguem precisa resolver", () => {
    const r = separarParaAutoBaixa([remessa({ ehTransferencia: true })], nunca);
    expect(r.automaticas).toHaveLength(0);
    expect(r.manuais).toHaveLength(0);
  });
});
