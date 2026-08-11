"use client";

import type { Modo } from "./ads-types";

const DESCRICOES: Record<Modo, { titulo: string; texto: string }> = {
  pub: {
    titulo: "Publicidade direta",
    texto: "Analisa apenas vendas atribuídas diretamente a cliques em anúncios. Use para avaliar eficiência do anúncio. Métrica de eficiência: ACOS (investido ÷ vendas diretas).",
  },
  geral: {
    titulo: "Geral",
    texto: "Analisa todas as vendas do item no período (ads + orgânico) e mostra o impacto total do investimento em Ads. Use para avaliar a rentabilidade do produto como um todo. Métrica de eficiência: TACOS (investido ÷ vendas totais — quanto menor, mais o Ads se paga sozinho dentro do faturamento geral do item).",
  },
  log: {
    titulo: "Alterações de campanha",
    texto: "Registre ajustes manuais de orçamento, ROAS e estratégia para comparar mudança versus resultado. Alterações registradas pela equipe — não vem do Mercado Livre.",
  },
};

/** ACOS e TACOS são a mesma conta (investido ÷ vendas) sobre bases diferentes — explícito aqui pra não exigir que o usuário infira a diferença. */
export default function AdsModeDescription({ modo }: { modo: Modo }) {
  const d = DESCRICOES[modo];
  return (
    <div style={{ fontSize: ".8rem", color: "var(--muted)", lineHeight: 1.5, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
      <b style={{ color: "var(--text)" }}>{d.titulo}.</b> {d.texto}
    </div>
  );
}
