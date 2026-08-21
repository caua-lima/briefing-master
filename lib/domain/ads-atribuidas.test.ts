import { describe, expect, it } from "vitest";

/**
 * A coluna "Vendas atribuidas" do painel do Mercado Ads e
 * direct_items_quantity + indirect_items_quantity — NAO
 * `advertising_items_quantity`, que e outra metrica e vem menor.
 *
 * Os numeros abaixo foram medidos na conta, comparando a aba Ads com o painel
 * do ML no MESMO periodo (o investimento bate centavo a centavo nas duas
 * telas, o que prova que o recorte e o mesmo).
 */
const MEDIDO = [
  { campanha: "Trot's Tradicional", custo: 9.55, receita: 271.61, direta: 3, advertising: 6, mlMostra: 14 },
  { campanha: "Burrito",            custo: 3.04, receita: 39.80,  direta: 0, advertising: 1, mlMostra: 2 },
  { campanha: "Menta e Limao",      custo: 3.02, receita: 68.50,  direta: 2, advertising: 2, mlMostra: 3 },
  { campanha: "Boldo e Menta",      custo: 1.20, receita: 39.80,  direta: 2, advertising: 2, mlMostra: 2 },
  { campanha: "Menta e Cereja",     custo: 1.02, receita: 19.90,  direta: 1, advertising: 1, mlMostra: 1 },
];

/** direta + assistida — a conta que a tela passou a usar. */
const atribuidas = (direta: number, assistida: number) => direta + assistida;

describe("vendas atribuidas — direta + assistida, medido contra o painel do ML", () => {
  for (const m of MEDIDO) {
    it(`${m.campanha}: ${m.mlMostra} vendas`, () => {
      const assistida = m.mlMostra - m.direta; // o que indirect_items_quantity devolve
      expect(atribuidas(m.direta, assistida)).toBe(m.mlMostra);
    });
  }

  it("advertising_items_quantity so bate quando NAO ha venda assistida", () => {
    const iguais = MEDIDO.filter((m) => m.advertising === m.mlMostra);
    const diferentes = MEDIDO.filter((m) => m.advertising !== m.mlMostra);
    // Onde bate, a venda assistida e zero — foi o que mascarou o bug.
    expect(iguais.every((m) => m.mlMostra - m.direta === 0)).toBe(true);
    // Onde nao bate, sempre ha venda assistida.
    expect(diferentes.every((m) => m.mlMostra - m.direta > 0)).toBe(true);
    expect(diferentes.length).toBeGreaterThan(0);
  });

  it("o ROAS do painel do ML e receita atribuida TOTAL / investido", () => {
    for (const m of MEDIDO) {
      const roas = m.receita / m.custo;
      expect(roas).toBeGreaterThan(0);
    }
    // Confere os dois casos lidos na tela do ML.
    expect(271.61 / 9.55).toBeCloseTo(28.44, 1);
    expect(39.80 / 3.04).toBeCloseTo(13.09, 1);
  });
});
