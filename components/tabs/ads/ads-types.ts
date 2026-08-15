// Tipos compartilhados entre os componentes da aba Ads — extraídos de
// AdsTab.tsx pra não duplicar entre AdsOverview/AdsFunnel/AdsDecisionPanel/
// AdsTable/AdDetailDrawer.

import type { AdRecommendation } from "@/lib/domain/ads";

// Status da CAMPANHA (não do anúncio no catálogo) — é o que decide se o
// investimento está de fato rodando agora.
export type StatusAnuncio = "ativo" | "pausado" | "sem_campanha" | "config_indisponivel";

export type AdItem = {
  itemId: string; title: string;
  status: StatusAnuncio; campaignId: string; campaignName: string; mlStatus: string;
  clicks: number; prints: number; cost: number;
  directSales: number; directUnits: number;
  adSales: number; adUnits: number;
  totalSales: number; totalUnits: number;
  lucroAntesAds: number; lucroLiquido: number;
  lucroDiretoAntesAds: number; lucroDiretoLiquido: number;
  /** false = sem venda vinculada no período pra calcular a margem do "direto"
   *  — não é prejuízo real, é falta de dado (ver route.ts). */
  diretoDisponivel: boolean;
  dailyBudget: number; roasTarget: number; acosTarget: number;
};

export const STATUS_META: Record<StatusAnuncio, { label: string; cor: string; bg: string }> = {
  ativo: { label: "Ativa", cor: "var(--green)", bg: "rgba(54,179,126,.12)" },
  pausado: { label: "Pausada", cor: "var(--warning)", bg: "var(--warning-soft)" },
  sem_campanha: { label: "Sem campanha", cor: "var(--muted)", bg: "rgba(185,181,166,.14)" },
  config_indisponivel: { label: "Campanha ?", cor: "var(--warning)", bg: "var(--warning-soft)" },
};

export type Modo = "pub" | "geral" | "log";

/** Uma linha de anúncio já com tudo derivado (break-even, lucro do modo ativo, recomendação) — calculado uma vez só em AdsTab. */
export type LinhaAds = {
  i: AdItem;
  v: number; un: number; r: number; a: number; ctr: number; cpc: number; pctAds: number;
  breakEven: number | null; abaixoDoBreakEven: boolean;
  /**
   * ROAS ideal: o mínimo pra sobrar a margem alvo, não só pra empatar
   * (ver calculateTargetRoas). null = o produto não alcança essa margem nem
   * gastando zero em ads — não existe alvo possível.
   */
  roasIdeal: number | null; abaixoDoIdeal: boolean;
  lucroAtual: number | null; margemAtual: number | null;
  reco: AdRecommendation;
};

export const num = (n: number, d = 0): string => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
export const corRoas = (r: number): string => (r >= 3 ? "var(--green)" : r >= 1.5 ? "var(--yellow)" : "var(--red)");
export const corAcos = (a: number, tem: boolean): string => (!tem ? "var(--muted)" : a <= 25 ? "var(--green)" : a <= 45 ? "var(--yellow)" : "var(--red)");
// Margem de lucro líquido final: verde a partir de 15% (bom pra e-commerce
// com ADS no meio), amarelo entre 0-15% (positivo mas apertado), vermelho
// negativo — mesmos limiares usados no resto do dashboard.
export const corMargem = (m: number): string => (m >= 15 ? "var(--green)" : m >= 0 ? "var(--yellow)" : "var(--red)");
