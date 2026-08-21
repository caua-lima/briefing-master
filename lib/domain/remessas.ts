import type { EstoqueMovimento } from "./types";

export type ProdutoRemessa = {
  inventory: string;
  nome: string;
  cadastrado: boolean;
  productId: string;
  qtd: number;
};

export type TipoRemessa = { tipo: string; qtd: number };

export type Remessa = {
  remessa: string;
  data: string;
  recebido: number;
  problema: number;
  saldoFull: number;
  produtos: ProdutoRemessa[];
  tipos: TipoRemessa[];
  refs: string[];
  /** Só TRANSFER_DELIVERY: unidade vinda de outro centro do ML, não é envio seu. */
  ehTransferencia: boolean;
  /**
   * Taxa que o ML cobrou pra levar esta remessa de casa até o centro do Full.
   * `null` = a API não devolveu o custo — diferente de 0 (coleta grátis).
   * Nunca tratar null como zero: subestimaria o custo e inflaria o lucro.
   */
  custo?: number | null;
  /** true = veio de valor digitado a mao (o ML mostra como ESTIMADO), não da API. */
  custoEstimado?: boolean;
};

/**
 * id fixo por remessa+produto. Como o Firestore grava pelo id, reprocessar a
 * mesma remessa escreve no mesmo lugar e nunca gera baixa dobrada.
 */
export function movIdRemessa(remessa: string, productId: string): string {
  return `full-${remessa}-${productId}`;
}

/**
 * A remessa só conta como resolvida quando TODO produto com cadastro já tem a
 * baixa (não basta um). Era `.some()`: se "Dar baixa" gravasse 2 de 3 produtos
 * e falhasse no 3º (erro de rede no meio do loop), a remessa já aparecia como
 * "✓ baixa dada" na próxima carga — o 3º produto nunca seria corrigido, porque
 * ninguém veria que faltava. Produto sem cadastro nunca entra nesta conta
 * (não há como dar baixa nele), então uma remessa 100% sem cadastro não conta
 * como resolvida por "não ter nada pendente" — ela fica pendente até alguém
 * cadastrar e dar baixa, ou marcar "já lancei".
 */
export function remessaTemBaixa(r: Remessa, movimentos: EstoqueMovimento[]): boolean {
  const comCadastro = r.produtos.filter((p) => p.productId);
  if (!comCadastro.length) return false;
  return comCadastro.every((p) => movimentos.some((m) => m.id === movIdRemessa(r.remessa, p.productId)));
}

/**
 * Pendente = envio seu que ainda não virou baixa nem foi marcado como
 * lançado à mão. É o que o aviso do Dashboard e a aba de Estoque mostram —
 * a mesma regra nos dois lugares, para não divergirem.
 */
export function remessasPendentes(
  remessas: Remessa[],
  movimentos: EstoqueMovimento[],
  ignoradas: Set<string>,
): Remessa[] {
  return remessas.filter(
    (r) => !r.ehTransferencia && !ignoradas.has(r.remessa) && !remessaTemBaixa(r, movimentos),
  );
}

/**
 * Unidades que estão contadas DUAS vezes: já entraram no Full e ainda não
 * saíram do livro do galpão.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────
 *
 * O `qtdLocal` ("em casa") só desce quando alguém registra a saída pro Full.
 * Mas a baixa automática roda dentro da aba Full, e só depois de clicar em
 * "Buscar remessas" — quem não abre aquela aba nunca dispara nada. Enquanto
 * isso, as unidades já chegaram no centro de distribuição e passam a contar
 * no Full também.
 *
 * O resultado é um total inflado que parece um erro de cálculo: 23 un "em
 * casa" que já não existem, somadas às 22 que estão no Full, viram 45 — sendo
 * que existem 22. Foi exatamente assim que apareceu.
 *
 * Isto NÃO corrige o número sozinho, de propósito. A baixa é lançamento de
 * verdade: mexe no livro e no custo médio. Descontar só na tela faria o
 * painel discordar do livro, trocando um problema por outro mais difícil de
 * enxergar. O que devolvemos é o tamanho exato da diferença, pra tela poder
 * dizer quanto está duplicado e mandar a pessoa pro lugar que resolve.
 */
export function unidadesPendentesPorProduto(
  remessas: Remessa[],
  movimentos: EstoqueMovimento[],
  ignoradas: Set<string>,
): Map<string, number> {
  const porProduto = new Map<string, number>();
  for (const r of remessasPendentes(remessas, movimentos, ignoradas)) {
    for (const p of r.produtos) {
      // Produto sem cadastro não tem de quem descontar — não há duplicação
      // rastreável, e inventá-la aqui só geraria um alerta impossível de agir.
      if (!p.productId || p.qtd <= 0) continue;
      porProduto.set(p.productId, (porProduto.get(p.productId) ?? 0) + p.qtd);
    }
  }
  return porProduto;
}
