import type { Remessa } from "./remessas";

/**
 * Decide se uma remessa do Full pode ter a baixa de estoque aplicada SOZINHA,
 * sem alguém conferir.
 *
 * A régua é deliberadamente conservadora: automatizar baixa de estoque errada
 * é pior do que não automatizar, porque o erro entra silencioso no custo médio
 * e contamina a margem de todas as vendas seguintes. Então só passa o caso em
 * que não existe nada pra decidir — quando há qualquer ambiguidade, a remessa
 * continua indo pra conferência manual, que é o fluxo que já existe.
 *
 * Os bloqueios, e por que cada um existe:
 *
 * - `ehTransferencia`: unidade vinda de outro centro do ML, não saiu da sua
 *   casa. Dar baixa aqui descontaria estoque duas vezes.
 * - `problema > 0`: unidade chegou mas não virou vendável (avaria, divergência
 *   de conferência). É exatamente o caso que precisa de olho humano — é
 *   prejuízo, e o número a baixar não é óbvio.
 * - produto sem cadastro: não há de quem descontar. Baixar só o resto deixaria
 *   a remessa "resolvida" com parte não lançada.
 * - `recebido <= 0`: nada a lançar.
 */
export type DecisaoAutoBaixa =
  | { pode: true }
  | { pode: false; motivo: string };

export function podeBaixarAutomatico(r: Remessa): DecisaoAutoBaixa {
  if (r.ehTransferencia) {
    return { pode: false, motivo: "transferência entre centros do ML — não saiu do seu estoque" };
  }
  if (r.recebido <= 0) {
    return { pode: false, motivo: "sem unidades recebidas" };
  }
  if ((r.problema ?? 0) > 0) {
    return { pode: false, motivo: `${r.problema} unidade(s) com divergência — precisa de conferência` };
  }
  if (r.produtos.length === 0) {
    return { pode: false, motivo: "remessa sem produtos identificados" };
  }
  const semCadastro = r.produtos.filter((p) => !p.productId);
  if (semCadastro.length > 0) {
    return { pode: false, motivo: `${semCadastro.length} produto(s) sem cadastro no Estoque` };
  }
  return { pode: true };
}

/**
 * Separa as remessas em "dá pra aplicar sozinho" e "precisa de você", já
 * ignorando o que foi resolvido. Puro pra caber em teste sem Firestore.
 */
export function separarParaAutoBaixa(
  remessas: Remessa[],
  jaResolvida: (r: Remessa) => boolean,
): { automaticas: Remessa[]; manuais: { remessa: Remessa; motivo: string }[] } {
  const automaticas: Remessa[] = [];
  const manuais: { remessa: Remessa; motivo: string }[] = [];

  for (const r of remessas) {
    if (jaResolvida(r)) continue;
    const d = podeBaixarAutomatico(r);
    if (d.pode) automaticas.push(r);
    // Transferência não é pendência de ninguém: some da lista em vez de
    // virar um "precisa de você" que nunca vai ser resolvido.
    else if (!r.ehTransferencia) manuais.push({ remessa: r, motivo: d.motivo });
  }
  return { automaticas, manuais };
}
