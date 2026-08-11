// Coletas agendadas pro Full (puro). A API pública do Mercado Livre não
// expõe "coleta agendada"/"em trânsito" — só o recebimento já processado
// (ver comentário em app/api/ml/gestao-full/route.ts). Por isso o ciclo de
// vida é MANUAL (agendado → em transporte → recebido/cancelado) e o "casar
// com o recebimento real" é uma sugestão que precisa de confirmação — nunca
// aplicado sozinho, pra não inventar que uma coleta chegou sem confirmação.

import type { FullColeta, FullColetaStatus } from "./types";
import type { Remessa } from "./remessas";

const ORDEM: FullColetaStatus[] = ["agendado", "em_transporte", "recebido"];

/** Próximo status no ciclo normal, ou null se já é terminal (recebido/cancelado). */
export function proximaTransicao(status: FullColetaStatus): FullColetaStatus | null {
  const i = ORDEM.indexOf(status);
  if (i === -1 || i === ORDEM.length - 1) return null;
  return ORDEM[i + 1];
}

/** Só agendado/em_transporte podem ser cancelados — recebido/cancelado são terminais. */
export function podeCancelar(status: FullColetaStatus): boolean {
  return status === "agendado" || status === "em_transporte";
}

export function ehTerminal(status: FullColetaStatus): boolean {
  return status === "recebido" || status === "cancelado";
}

export type SugestaoVinculo = { remessa: string; data: string; qtdRecebida: number };

/**
 * Acha a remessa REAL (recebida) que mais provavelmente corresponde a uma
 * coleta "em_transporte": mesmo produto, quantidade recebida bate exatamente
 * com a agendada, e a data de recebimento é igual ou posterior à data
 * agendada (não pode ter chegado antes de ser despachada) dentro de uma
 * janela de 45 dias (recebimento demorado demais provavelmente é outra
 * coisa). Entre candidatas, a mais próxima da data agendada. Não decide
 * nada sozinha — só sugere; quem chama pede confirmação ao usuário antes de
 * gravar `remessaVinculada`.
 */
export function sugerirVinculoRecebimento(
  coleta: Pick<FullColeta, "productId" | "quantidade" | "dataAgendada">,
  remessas: Remessa[],
  jaVinculadas: Set<string>,
  janelaDias = 45,
): SugestaoVinculo | null {
  const inicio = Date.parse(coleta.dataAgendada);
  if (Number.isNaN(inicio)) return null;

  let melhor: SugestaoVinculo | null = null;
  let melhorDelta = Infinity;

  for (const r of remessas) {
    if (r.ehTransferencia) continue;
    if (jaVinculadas.has(r.remessa)) continue;
    const prod = r.produtos.find((p) => p.productId === coleta.productId);
    if (!prod || prod.qtd !== coleta.quantidade) continue;

    const dataRecebida = Date.parse(r.data);
    if (Number.isNaN(dataRecebida)) continue;
    const deltaDias = (dataRecebida - inicio) / 86400000;
    if (deltaDias < 0 || deltaDias > janelaDias) continue;

    if (deltaDias < melhorDelta) {
      melhorDelta = deltaDias;
      melhor = { remessa: r.remessa, data: r.data, qtdRecebida: prod.qtd };
    }
  }
  return melhor;
}

/** Soma agendada + em transporte (o que ainda não chegou, mas já saiu de casa ou vai sair) — pra mostrar "X em trânsito pro Full" sem tocar em qtdLocal/custoMedio. */
export function totalEmTransito(coletas: FullColeta[], productId?: string): number {
  return coletas
    .filter((c) => (c.status === "agendado" || c.status === "em_transporte") && (!productId || c.productId === productId))
    .reduce((s, c) => s + c.quantidade, 0);
}
