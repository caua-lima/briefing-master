/**
 * Leitura da reputação do vendedor (seller_reputation, já vem de graça em
 * app/api/ml/account/route.ts → user.seller_reputation). Nada aqui bate em
 * API — só interpreta o que o Mercado Livre devolve.
 *
 * O ML não documenta publicamente os critérios exatos pra subir de selo
 * (Mercado Líder → Gold → Platinum): por isso mostramos o nível ATUAL e o
 * NOME do próximo degrau, sem inventar % de progresso.
 */

export type SellerReputation = {
  level_id?: string | null;
  power_seller_status?: string | null;
  transactions?: {
    completed?: number;
    canceled?: number;
    ratings?: { positive?: number; negative?: number; neutral?: number };
  } | null;
};

const LEVEL_META: Record<string, { label: string; cor: string }> = {
  "5_green": { label: "Verde — melhor nível", cor: "var(--green)" },
  "4_light_green": { label: "Verde claro", cor: "var(--green)" },
  "3_yellow": { label: "Amarelo — atenção", cor: "var(--yellow)" },
  "2_orange": { label: "Laranja — atenção", cor: "#F4B942" },
  "1_red": { label: "Vermelho — crítico", cor: "var(--red)" },
};

export function getReputationLevelMeta(levelId: string | null | undefined): { label: string; cor: string } {
  if (!levelId) return { label: "Sem nível calculado ainda", cor: "var(--muted)" };
  return LEVEL_META[levelId] ?? { label: levelId, cor: "var(--muted)" };
}

const POWER_SELLER_META: Record<string, { label: string; ordem: number }> = {
  silver: { label: "Mercado Líder", ordem: 1 },
  gold: { label: "Mercado Líder Gold", ordem: 2 },
  platinum: { label: "Mercado Líder Platinum", ordem: 3 },
};

const PROXIMO_DEGRAU = ["Mercado Líder", "Mercado Líder Gold", "Mercado Líder Platinum"];

export function getPowerSellerLabel(status: string | null | undefined): string {
  if (!status) return "Ainda sem selo de Mercado Líder";
  return POWER_SELLER_META[status]?.label ?? status;
}

export function getPowerSellerOrdem(status: string | null | undefined): number {
  if (!status) return 0;
  return POWER_SELLER_META[status]?.ordem ?? 0;
}

/** Nome do próximo degrau, ou null se já está no topo (Platinum). */
export function getProximoNivelLabel(status: string | null | undefined): string | null {
  const ordem = getPowerSellerOrdem(status);
  return ordem >= 3 ? null : PROXIMO_DEGRAU[ordem];
}
