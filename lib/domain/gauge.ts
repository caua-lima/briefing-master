// Helpers puros de apresentação para os velocímetros do Dashboard
// (PerformanceGauge). Nada aqui calcula números de negócio — os valores
// (faturamento, meta, margem, projeção etc.) continuam vindo prontos de
// Dashboard.tsx, que é o único lugar com as fórmulas financeiras. Este
// arquivo só decide COMO mostrar um par (valor, meta) já calculado: qual
// % pintar no arco, qual cor/tom usar, qual texto de status/insight.

export type GaugeTone = "success" | "warning" | "danger" | "neutral";
export type GaugeKind = "revenue" | "margin";

/** % pro ARCO (posição do ponteiro) — sempre 0–100, nunca estoura o desenho. */
export function clampGaugePercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  const pct = (value / max) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

/** % REAL pro texto central — pode passar de 100 (ex.: "118%"), nunca inventa dado com max<=0. */
export function rawGoalPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  const pct = (value / max) * 100;
  return Number.isFinite(pct) ? pct : 0;
}

/**
 * Tom do arco/pill a partir do % real já calculado por quem chama.
 * Faturamento: 0–59% risco, 60–89% atenção, 90–100% "no ritmo" (neutral,
 * pintado em dourado no arco), 100%+ sucesso.
 * Margem: abaixo de 70% da meta = risco, 70–99% = atenção, >=100% = sucesso.
 */
export function getGaugeStatus(kind: GaugeKind, rawPct: number): GaugeTone {
  if (kind === "revenue") {
    if (rawPct >= 100) return "success";
    if (rawPct >= 90) return "neutral";
    if (rawPct >= 60) return "warning";
    return "danger";
  }
  if (rawPct >= 100) return "success";
  if (rawPct >= 70) return "warning";
  return "danger";
}

/** Texto curto do status pill — nunca só a cor, sempre com uma frase objetiva. */
export function getGaugeStatusLabel(kind: GaugeKind, rawPct: number, tone: GaugeTone): string {
  if (kind === "revenue") {
    if (rawPct > 100) return "Meta superada";
    if (rawPct >= 100) return "Meta atingida";
    if (tone === "neutral") return "No ritmo da meta";
    if (tone === "warning") return "Atenção ao ritmo";
    return "Abaixo do ritmo";
  }
  if (rawPct >= 100) return "Margem saudável";
  if (tone === "warning") return "Margem em atenção";
  return "Margem abaixo da meta";
}

function fmtBRLLocal(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Formata o insight de 1-2 linhas a partir de números JÁ calculados por
 * Dashboard.tsx (falta, ritmo necessário, projeção, delta de margem) — só
 * monta a frase, não recalcula nada.
 */
export function getGoalInsight(
  kind: GaugeKind,
  p: {
    falta?: number;
    ritmoDiaNecessario?: number;
    projecao?: number;
    metaLabel?: string;
    margemAtual?: number;
    metaMargem?: number;
  },
): string {
  if (kind === "revenue") {
    if (p.falta != null && p.falta <= 0) {
      return p.projecao != null
        ? `Meta batida — projeção de fechamento ${fmtBRLLocal(p.projecao)}.`
        : "Meta batida.";
    }
    const partes: string[] = [];
    if (p.falta != null) partes.push(`Faltam ${fmtBRLLocal(p.falta)} para a ${p.metaLabel ?? "meta"}.`);
    if (p.ritmoDiaNecessario != null) partes.push(`Precisa de ${fmtBRLLocal(p.ritmoDiaNecessario)}/dia.`);
    if (p.projecao != null) partes.push(`No ritmo atual, a projeção é ${fmtBRLLocal(p.projecao)}.`);
    return partes.join(" ");
  }
  if (p.margemAtual != null && p.metaMargem != null) {
    const delta = p.margemAtual - p.metaMargem;
    return delta >= 0
      ? `Meta: ${p.metaMargem.toFixed(1)}% · Atual: ${p.margemAtual.toFixed(1)}% (${delta.toFixed(1)} p.p. acima).`
      : `Meta: ${p.metaMargem.toFixed(1)}% · Atual: ${p.margemAtual.toFixed(1)}% (${Math.abs(delta).toFixed(1)} p.p. abaixo).`;
  }
  return "";
}
