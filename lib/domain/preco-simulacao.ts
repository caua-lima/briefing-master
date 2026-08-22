/**
 * Simulação de preço — "se eu vender a R$ X, quanto sobra?"
 *
 * ─── POR QUE ISTO NÃO É UMA REGRA DE TRÊS ───────────────────────────────
 *
 * A tentação é pegar a margem de uma venda passada e aplicar no preço novo.
 * Não funciona, e os dois motivos vieram de medição contra a API real (conta
 * VAZXPRESS, categoria MLB247522, anúncio Clássico):
 *
 *   preço  78,99 → comissão 11,06  (14%)
 *   preço 250,00 → comissão 27,50  (11%)
 *
 * A alíquota MUDA com o preço. Extrapolar 14% pra R$250 daria R$35 de
 * comissão — R$7,50 a mais do que o ML de fato cobra, e a decisão de preço
 * sairia errada pro lado errado (parece pior do que é).
 *
 * Além disso, `fixed_fee` nessa categoria é ZERO — a taxa fixa de itens
 * baratos que existe em outras categorias não vale aqui. Por isso NADA é
 * hardcodado: a comissão vem sempre do endpoint `/sites/MLB/listing_prices`
 * consultado PARA O PREÇO SIMULADO (ver app/api/ml/simular-preco/route.ts).
 *
 * Este módulo é puro: recebe os números já buscados e faz a conta. É o que
 * permite testar a aritmética sem rede — e é a MESMA fórmula do resto do app
 * (ver app/api/ml/pedidos/route.ts): se divergisse, a simulação prometeria um
 * lucro que o Dashboard depois não confirmaria.
 */

export type EntradaSimulacao = {
  /** Preço de venda que se quer testar. */
  preco: number;
  /** Comissão do ML para ESTE preço, vinda de listing_prices — nunca estimada. */
  comissao: number;
  /**
   * Frete que o VENDEDOR paga (list_cost de shipping_options). Zero quando o
   * comprador paga o frete inteiro.
   */
  frete: number;
  /** Custo do produto (custo médio do estoque), por unidade. */
  custo: number;
  /** Alíquota de imposto sobre a venda, em % (ex.: 8 = 8%). */
  impostoPct: number;
  /**
   * Custo de publicidade rateado por unidade, opcional. Só entra se o vendedor
   * informar — inventar um valor aqui contaminaria a decisão de preço.
   */
  adsPorUnidade?: number;
  /** Outros custos por unidade (embalagem, etiqueta...), opcional. */
  outrosPorUnidade?: number;
};

export type ResultadoSimulacao = {
  preco: number;
  comissao: number;
  frete: number;
  custo: number;
  imposto: number;
  ads: number;
  outros: number;
  /** O que sobra depois de TODOS os custos. */
  lucro: number;
  /** lucro ÷ preço, em %. */
  margem: number;
  /** lucro ÷ custo, em % — quanto o dinheiro investido rende. */
  markup: number;
  /** preço − comissão − frete: o que o ML repassa antes dos seus custos. */
  repasse: number;
};

export function simularPreco(e: EntradaSimulacao): ResultadoSimulacao {
  const preco = Math.max(e.preco, 0);
  const comissao = Math.max(e.comissao, 0);
  const frete = Math.max(e.frete, 0);
  const custo = Math.max(e.custo, 0);
  const ads = Math.max(e.adsPorUnidade ?? 0, 0);
  const outros = Math.max(e.outrosPorUnidade ?? 0, 0);
  // Imposto incide sobre a venda (mesma regra de impostoNaData no resto do app).
  const imposto = preco * (Math.max(e.impostoPct, 0) / 100);

  const repasse = preco - comissao - frete;
  const lucro = repasse - custo - imposto - ads - outros;

  return {
    preco, comissao, frete, custo, imposto, ads, outros,
    lucro,
    margem: preco > 0 ? (lucro / preco) * 100 : 0,
    // Sem custo cadastrado, markup seria divisão por zero — 0 comunica
    // "não dá pra calcular" melhor que Infinity na tela.
    markup: custo > 0 ? (lucro / custo) * 100 : 0,
    repasse,
  };
}

/**
 * Preço mínimo pra atingir uma margem-alvo, resolvido por BUSCA BINÁRIA.
 *
 * Não dá pra isolar algebricamente: a comissão do ML não é linear no preço
 * (muda de faixa, como medido acima) e só é conhecida consultando a API preço
 * a preço. Então a busca chama `comissaoDe` a cada tentativa — quem passa essa
 * função decide se ela bate na API ou usa um cache.
 *
 * ~40 iterações cobrem de R$0,01 a ~R$1M com precisão de centavo. Devolve null
 * quando a margem-alvo é inalcançável em qualquer preço do intervalo (custo
 * alto demais), em vez de um número que não se sustenta.
 */
export async function precoParaMargem(
  margemAlvo: number,
  base: Omit<EntradaSimulacao, "preco" | "comissao">,
  comissaoDe: (preco: number) => Promise<number>,
  opts: { min?: number; max?: number; iteracoes?: number } = {},
): Promise<number | null> {
  const min = opts.min ?? 0.01;
  const max = opts.max ?? 1_000_000;
  const iteracoes = opts.iteracoes ?? 40;

  let lo = min;
  let hi = max;
  let melhor: number | null = null;

  for (let i = 0; i < iteracoes; i++) {
    const meio = (lo + hi) / 2;
    const r = simularPreco({ ...base, preco: meio, comissao: await comissaoDe(meio) });
    if (r.margem >= margemAlvo) {
      // Atingiu: guarda e tenta um preço menor que ainda atinja.
      melhor = meio;
      hi = meio;
    } else {
      lo = meio;
    }
  }

  // Arredonda pra cima no centavo: arredondar pra baixo devolveria um preço
  // que fica MARGINALMENTE abaixo da meta que o usuário pediu.
  return melhor == null ? null : Math.ceil(melhor * 100) / 100;
}
