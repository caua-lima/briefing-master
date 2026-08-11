// Formatação do changelog manual de Ads (puro). Registro estruturado
// (tipo + valor anterior + valor novo) vira frase pronta pra lista, sem
// precisar que quem lê monte a leitura na cabeça.

import { ADS_ALTERACAO_TIPO_LABEL, type AdsAlteracao, type AdsAlteracaoTipo } from "./types";

export type ResumoAlteracao = Pick<AdsAlteracao, "tipo" | "valorAnterior" | "valorNovo" | "nota">;

/**
 * "ROAS alvo: 16x → 20x" quando há valor anterior E novo; "Orçamento: R$
 * 30/dia" quando só há valor novo (primeira vez, sem anterior conhecido);
 * cai pra `nota` (texto livre) quando não há valores estruturados — cobre o
 * registro antigo, que só tinha nota.
 */
export function formatarResumoAlteracao(entry: ResumoAlteracao): string {
  const label = entry.tipo ? ADS_ALTERACAO_TIPO_LABEL[entry.tipo] : null;
  const antes = entry.valorAnterior?.trim();
  const depois = entry.valorNovo?.trim();

  if (label && antes && depois) return `${label}: ${antes} → ${depois}`;
  if (label && depois) return `${label}: ${depois}`;
  if (label && antes) return `${label} (era ${antes})`;
  return entry.nota;
}

/** dias desde createdAt até agora — usado no drawer ("última alteração há N dias"). */
export function diasDesde(createdAt: number, agora: number): number {
  return Math.max(0, Math.floor((agora - createdAt) / 86400000));
}

export const ADS_ALTERACAO_TIPOS: AdsAlteracaoTipo[] = ["orcamento", "roas_alvo", "status", "criativo", "preco", "outro"];
