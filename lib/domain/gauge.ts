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

/**
 * Status do RITMO de faturamento do mês (usado no gauge "Meta do Mês N").
 *
 * Antes o tom vinha de `getGaugeStatus("revenue", fatBruto/meta*100)` — ou
 * seja, comparava o faturamento contra a META INTEIRA do mês. Isso é errado
 * pra "ritmo": no dia 5 de um mês de 31 dias, mesmo faturando EXATAMENTE no
 * ritmo ideal, só dá pra ter ~16% da meta batida — o que caía direto na
 * faixa "abaixo do ritmo" (<60%) mesmo estando em dia. "Ritmo" tem que
 * comparar contra o IDEAL ACUMULADO ATÉ HOJE (`idealDia` = meta ÷ dias do
 * mês × dia atual), não contra a meta inteira — só assim o início do mês
 * não fica sempre vermelho por definição.
 */
export function getRevenuePaceStatus(fatBruto: number, activeMeta: number, idealDia: number): GaugeTone {
  if (activeMeta > 0 && fatBruto >= activeMeta) return "success";
  if (idealDia <= 0) return "neutral";
  const pctDoIdeal = (fatBruto / idealDia) * 100;
  if (pctDoIdeal >= 100) return "neutral"; // no ritmo ou à frente — dourado, não é "sucesso" ainda (meta não bateu)
  if (pctDoIdeal >= 85) return "warning";
  return "danger";
}

/** Texto do pill de ritmo — mesma lógica de comparação contra o ideal-até-hoje. */
export function getRevenuePaceLabel(fatBruto: number, activeMeta: number, tone: GaugeTone): string {
  if (activeMeta > 0 && fatBruto > activeMeta) return "Meta superada";
  if (activeMeta > 0 && fatBruto >= activeMeta) return "Meta atingida";
  if (tone === "neutral") return "No ritmo da meta";
  if (tone === "warning") return "Atenção ao ritmo";
  return "Abaixo do ritmo";
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
