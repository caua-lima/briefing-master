// Regras da Central de Atenção — sem IA, só limiares sobre dados já
// calculados por app/api/ml/metrics/route.ts e pelo estoque. Nenhuma regra
// aqui inventa dado: quando falta informação (ex.: ADS indisponível), o
// alerta avisa disso em vez de fingir um número.

import { getCoverageStatus } from "./estoque";

export type AlertSeverity = "critical" | "warning" | "opportunity" | "success" | "info";
export type AlertCategoria = "margem" | "ads" | "estoque" | "meta" | "custos" | "pedidos" | "devolucoes";
export type AlertTab = "ads" | "estoque" | "metas" | "pedidos" | "dre" | "custos";

export type ActionAlert = {
  /** Estável — usado pra dedupe e pra "lembrar" que o usuário dispensou este alerta específico. */
  chave: string;
  severity: AlertSeverity;
  categoria: AlertCategoria;
  titulo: string;
  /** Sempre com um número real do período, nunca genérico. */
  explicacao: string;
  /** R$ estimado — positivo pra oportunidade, negativo pra risco. Omitido quando não é calculável com segurança. */
  impacto?: number;
  ctaLabel?: string;
  ctaTab?: AlertTab;
  /** Número que determina a severidade — usado pra saber se o alerta "piorou" depois de dispensado. */
  valorRef: number;
};

const SEVERITY_WEIGHT: Record<AlertSeverity, number> = {
  critical: 4, warning: 3, opportunity: 2, success: 1, info: 0,
};

export function sortAlertsByImpact(alerts: ActionAlert[]): ActionAlert[] {
  return [...alerts].sort((a, b) => {
    const w = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
    if (w !== 0) return w;
    return Math.abs(b.impacto ?? 0) - Math.abs(a.impacto ?? 0);
  });
}

/**
 * Um alerta dispensado só volta a aparecer se o número que o disparou piorou
 * de forma relevante desde então (não é "sumiu pra sempre", nem "reaparece a
 * qualquer flutuação de centavos").
 */
export function alertShouldReappear(currentValorRef: number, dismissedValorRef: number): boolean {
  const limiar = Math.max(1, Math.abs(dismissedValorRef) * 0.15);
  return Math.abs(currentValorRef - dismissedValorRef) > limiar;
}

function fmtBRLShort(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizeMlb(s: string): string {
  return s.trim().toUpperCase().replace(/^MLB/, "");
}

export type AlertAnuncio = {
  item_id: string;
  title: string;
  lucro: number;
  margem: number;
  vendas: number;
  ads: number;
  semVenda?: boolean;
};

export type AlertProduto = {
  id: string;
  name: string;
  ativo: boolean;
  qtdLocal?: number;
  mlb?: string;
  mlbs?: string[];
};

export type BuildAlertsInput = {
  anuncios: AlertAnuncio[];
  margemAtual: number;
  metaMargem: number;
  totalAds: number;
  adsFalhou: boolean;
  vendasCanceladas: number;
  vendasDevolvidas: number;
  faturamentoBruto: number;
  projecao: number;
  activeMeta: number;
  metaIndex: number;
  faturamentoHoje: number;
  metaDiariaAtiva: number | null;
  pedidosHoje: number;
  produtos: AlertProduto[];
  /** Vendas por produto num período fixo (30d) via /api/ml/estoque-forecast — opcional, some se indisponível. */
  estoqueForecast?: { vendas: Record<string, number>; dias: number } | null;
};

export function buildActionAlerts(input: BuildAlertsInput): ActionAlert[] {
  const {
    anuncios, margemAtual, metaMargem, totalAds, adsFalhou,
    vendasCanceladas, vendasDevolvidas, faturamentoBruto, projecao, activeMeta, metaIndex,
    faturamentoHoje, metaDiariaAtiva, pedidosHoje, produtos, estoqueForecast,
  } = input;
  const alerts: ActionAlert[] = [];

  // CRÍTICO — anúncio dando prejuízo com volume real (não é 1 venda isolada)
  for (const a of anuncios) {
    if (a.vendas >= 3 && a.lucro < 0) {
      alerts.push({
        chave: `margem-negativa-${a.item_id}`,
        severity: "critical",
        categoria: "margem",
        titulo: `${a.title || a.item_id} está dando prejuízo`,
        explicacao: `${a.vendas} venda(s) no período, lucro de ${fmtBRLShort(a.lucro)} (margem ${a.margem.toFixed(1)}%).`,
        impacto: a.lucro,
        ctaLabel: "Ver Ads",
        ctaTab: "ads",
        valorRef: a.lucro,
      });
    }
  }

  // CRÍTICO — estoque local zerado num produto que vendeu no período (cruza por MLB, best-effort de UI —
  // o vínculo oficial pro cálculo de lucro é o do backend em metrics/route.ts, isto é só pra alertar)
  const vendidos = new Set(anuncios.filter((a) => a.vendas > 0).map((a) => normalizeMlb(a.item_id)));
  for (const p of produtos) {
    if (!p.ativo) continue;
    if ((p.qtdLocal ?? 0) > 0) continue;
    const mlbs = (p.mlbs?.length ? p.mlbs : p.mlb ? [p.mlb] : []).map(normalizeMlb);
    if (!mlbs.some((m) => vendidos.has(m))) continue;
    alerts.push({
      chave: `ruptura-${p.id}`,
      severity: "critical",
      categoria: "estoque",
      titulo: `${p.name} sem estoque no galpão`,
      explicacao: "Vendeu no período, mas o estoque local está zerado — risco de furar o próximo pedido.",
      ctaLabel: "Ver Estoque",
      ctaTab: "estoque",
      valorRef: -1,
    });
  }

  // ALERTA — capital parado: tem estoque, mas zero venda no período do
  // forecast (30d por padrão). Diferente de "ruptura" (que é falta de
  // estoque) — aqui é excesso sem giro, dinheiro parado no galpão.
  if (estoqueForecast) {
    for (const p of produtos) {
      if (!p.ativo) continue;
      const qtd = p.qtdLocal ?? 0;
      if (qtd <= 0) continue;
      const vendasPeriodo = estoqueForecast.vendas[p.id] ?? 0;
      const coberturaDias = qtd > 0 && vendasPeriodo > 0 ? (qtd / (vendasPeriodo / estoqueForecast.dias)) : null;
      const status = getCoverageStatus(coberturaDias, qtd, vendasPeriodo);
      if (status !== "encalhado") continue;
      alerts.push({
        chave: `encalhado-${p.id}`,
        severity: "warning",
        categoria: "estoque",
        titulo: `${p.name} sem nenhuma venda em ${estoqueForecast.dias} dias`,
        explicacao: `${qtd} unidade(s) paradas no estoque, zero venda no período — capital parado no galpão.`,
        ctaLabel: "Ver Estoque",
        ctaTab: "estoque",
        valorRef: qtd,
      });
    }
  }

  // ALERTA — margem líquida abaixo da meta
  if (metaMargem > 0 && margemAtual < metaMargem) {
    alerts.push({
      chave: "margem-abaixo-meta",
      severity: "warning",
      categoria: "margem",
      titulo: "Margem líquida abaixo da meta",
      explicacao: `Margem atual de ${margemAtual.toFixed(1)}% contra meta de ${metaMargem.toFixed(1)}%.`,
      ctaLabel: "Ver DRE",
      ctaTab: "dre",
      valorRef: metaMargem - margemAtual,
    });
  }

  // ALERTA — Ads investido sem nenhuma venda direta
  const semVendaAds = anuncios.filter((a) => a.semVenda && a.ads > 0);
  if (semVendaAds.length > 0) {
    const total = semVendaAds.reduce((s, a) => s + a.ads, 0);
    alerts.push({
      chave: "ads-sem-venda",
      severity: "warning",
      categoria: "ads",
      titulo: `${semVendaAds.length} anúncio(s) com Ads sem nenhuma venda`,
      explicacao: `${fmtBRLShort(total)} investidos no período sem retorno direto.`,
      impacto: -total,
      ctaLabel: "Ver Ads",
      ctaTab: "ads",
      valorRef: -total,
    });
  }

  // ALERTA — projeção do mês fica abaixo da meta ativa
  if (activeMeta > 0 && projecao < activeMeta) {
    alerts.push({
      chave: "projecao-abaixo-meta",
      severity: "warning",
      categoria: "meta",
      titulo: `Projeção do mês fica abaixo da Meta ${metaIndex}`,
      explicacao: `No ritmo atual, a projeção de fechamento é ${fmtBRLShort(projecao)} contra meta de ${fmtBRLShort(activeMeta)}.`,
      impacto: projecao - activeMeta,
      ctaLabel: "Ver metas",
      ctaTab: "metas",
      valorRef: activeMeta - projecao,
    });
  }

  // ALERTA — cancelamentos + devoluções pesando (>3% do faturamento bruto)
  const perdaTotal = vendasCanceladas + vendasDevolvidas;
  if (faturamentoBruto > 0 && perdaTotal / faturamentoBruto > 0.03) {
    alerts.push({
      chave: "cancel-devol-relevante",
      severity: "warning",
      categoria: "devolucoes",
      titulo: "Cancelamentos e devoluções pesando no período",
      explicacao: `${fmtBRLShort(perdaTotal)} em pedidos cancelados/devolvidos (${((perdaTotal / faturamentoBruto) * 100).toFixed(1)}% do faturamento bruto).`,
      impacto: -perdaTotal,
      ctaLabel: "Ver Pedidos",
      ctaTab: "pedidos",
      valorRef: perdaTotal,
    });
  }

  // OPORTUNIDADE — anúncio com margem bem acima da meta e vendas consistentes
  for (const a of anuncios) {
    if (a.vendas >= 3 && a.lucro > 0 && metaMargem > 0 && a.margem >= metaMargem * 1.3) {
      alerts.push({
        chave: `oportunidade-margem-${a.item_id}`,
        severity: "opportunity",
        categoria: "margem",
        titulo: `${a.title || a.item_id} com margem forte`,
        explicacao: `Margem de ${a.margem.toFixed(1)}% em ${a.vendas} venda(s) — bem acima da meta de ${metaMargem.toFixed(1)}%.`,
        impacto: a.lucro,
        ctaLabel: "Ver Ads",
        ctaTab: "ads",
        valorRef: a.margem,
      });
    }
  }

  // SUCESSO — meta diária batida com margem saudável
  if (metaDiariaAtiva != null && metaDiariaAtiva > 0 && faturamentoHoje >= metaDiariaAtiva && metaMargem > 0 && margemAtual >= metaMargem) {
    alerts.push({
      chave: "sucesso-dia",
      severity: "success",
      categoria: "meta",
      titulo: "Meta diária batida com margem saudável",
      explicacao: `${fmtBRLShort(faturamentoHoje)} faturados hoje em ${pedidosHoje} pedido(s), margem de ${margemAtual.toFixed(1)}%.`,
      valorRef: 1,
    });
  }

  // INFO — nunca mostrar ADS "R$ 0" como se fosse dado confirmado
  if (adsFalhou) {
    alerts.push({
      chave: "ads-indisponivel",
      severity: "info",
      categoria: "ads",
      titulo: "Dados de Ads indisponíveis no período",
      explicacao: "O Mercado Livre não retornou o gasto de Ads agora — o número não é R$ 0, é dado faltando.",
      ctaLabel: "Atualizar agora",
      ctaTab: "ads",
      valorRef: 0,
    });
  } else if (totalAds === 0 && anuncios.length > 0) {
    alerts.push({
      chave: "ads-zerado-suspeito",
      severity: "info",
      categoria: "ads",
      titulo: "Investimento em Ads zerado no período",
      explicacao: "Pode ser real (sem campanha ativa) ou falha de autorização — confira o diagnóstico na aba Ads.",
      ctaLabel: "Ver Ads",
      ctaTab: "ads",
      valorRef: 0,
    });
  }

  return sortAlertsByImpact(alerts);
}
