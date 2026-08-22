/**
 * Lucro projetado do estoque parado — "se eu vender tudo que tenho, quanto sobra?"
 *
 * ─── POR QUE ISTO NÃO USA UMA COMISSÃO FIXA ─────────────────────────────
 *
 * A tentação é aplicar um percentual médio do ML sobre o preço do anúncio.
 * Não funciona: a alíquota muda com o preço e com a categoria — medido na
 * conta real, o MESMO anúncio paga 14% a R$78,99 e 11% a R$250 (o porquê
 * está em lib/domain/preco-simulacao.ts). Um "chute médio" erra mais no
 * produto caro, que é justamente onde o estoque prende mais dinheiro.
 *
 * Então a comissão e o frete vêm MEDIDOS das vendas que já aconteceram
 * (`/api/ml/estoque-forecast` devolve receita/taxaML/frete por produto, sem
 * chamada extra ao ML). Produto sem venda no período não tem taxa medida — e
 * aí o lucro é `null`, não zero: a tela mostra "—" em vez de um número que
 * ninguém pode defender.
 *
 * A fórmula é a MESMA de simularPreco e da rota de pedidos. Se divergisse, o
 * Estoque prometeria um lucro que o Dashboard depois não confirmaria.
 */

/** Realizado de um produto no período, vindo de /api/ml/estoque-forecast. */
export type FinanceiroProduto = {
  /** Soma de unit_price × quantidade das vendas do período. */
  receita: number;
  /** Soma de sale_fee × quantidade — comissão que o ML de fato cobrou. */
  taxaML: number;
  /** Frete do vendedor rateado por unidade e somado. */
  frete: number;
  /** Unidades vendidas no período. */
  unidades: number;
};

export type TaxasMedidas = {
  /** Comissão do ML como fração do preço (0.14 = 14%), medida no realizado. */
  comissaoPct: number;
  /** Frete do vendedor por unidade, em R$. */
  fretePorUnidade: number;
};

/**
 * Extrai as taxas efetivas do que já foi vendido. `null` quando não houve
 * venda com receita no período — sem base medida, não há projeção honesta.
 */
export function medirTaxas(f: FinanceiroProduto | undefined): TaxasMedidas | null {
  if (!f || f.receita <= 0 || f.unidades <= 0) return null;
  return {
    comissaoPct: f.taxaML / f.receita,
    fretePorUnidade: f.frete / f.unidades,
  };
}

export type EntradaLucroEstoque = {
  /** Preço de venda do anúncio, por unidade. */
  preco: number;
  /** Custo médio do produto, por unidade. */
  custo: number;
  /** Alíquota de imposto sobre a venda, em % (ex.: 8 = 8%). */
  impostoPct: number;
  /** Unidades em estoque (casa + Full, cada pool contado uma vez). */
  unidades: number;
  /** Taxas medidas no realizado; `null` = produto sem venda no período. */
  taxas: TaxasMedidas | null;
};

export type LucroEstoque = {
  /** Lucro de UMA unidade, depois de comissão, frete, custo e imposto. */
  lucroUnitario: number;
  /** lucroUnitario × unidades — o que o estoque parado ainda pode render. */
  lucroTotal: number;
  /** lucroUnitario ÷ preço, em %. */
  margem: number;
  /** Receita bruta se tudo for vendido ao preço atual. */
  receitaPotencial: number;
};

/**
 * Lucro que o estoque atual ainda pode gerar, ao preço de anúncio de hoje.
 *
 * Devolve `null` quando falta base pra afirmar: sem preço ou sem taxa medida.
 * Zero seria pior que "não sei" — some do alerta de prejuízo e some do total.
 */
export function calcularLucroEstoque(e: EntradaLucroEstoque): LucroEstoque | null {
  const preco = Math.max(e.preco, 0);
  if (preco <= 0 || e.taxas == null) return null;

  const unidades = Math.max(e.unidades, 0);
  const custo = Math.max(e.custo, 0);
  const comissao = preco * Math.max(e.taxas.comissaoPct, 0);
  const frete = Math.max(e.taxas.fretePorUnidade, 0);
  const imposto = preco * (Math.max(e.impostoPct, 0) / 100);

  const lucroUnitario = preco - comissao - frete - custo - imposto;

  return {
    lucroUnitario,
    lucroTotal: lucroUnitario * unidades,
    margem: (lucroUnitario / preco) * 100,
    receitaPotencial: preco * unidades,
  };
}
