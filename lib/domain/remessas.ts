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
