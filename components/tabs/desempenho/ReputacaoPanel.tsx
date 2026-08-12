"use client";

import {
  METRIC_LABELS,
  formatTaxaDecimal,
  getPowerSellerLabel,
  getProximoNivelLabel,
  getReputationLevelMeta,
  type SellerReputation,
} from "@/lib/domain/reputation";

function fmtPct01(v: number | undefined): string | null {
  return formatTaxaDecimal(v);
}

export default function ReputacaoPanel({
  reputation, indisponivel,
}: {
  reputation: SellerReputation | null;
  indisponivel: boolean;
}) {
  if (indisponivel) {
    return (
      <div className="panel">
        <div className="panel-title" style={{ marginBottom: 6 }}>Reputação no Mercado Livre</div>
        <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>
          Não consegui buscar a reputação agora (token do ML pode estar sem acesso). Tente reconectar o ML.
        </div>
      </div>
    );
  }
  if (!reputation) {
    return (
      <div className="panel">
        <div className="panel-title" style={{ marginBottom: 6 }}>Reputação no Mercado Livre</div>
        <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>Carregando…</div>
      </div>
    );
  }

  const nivel = getReputationLevelMeta(reputation.level_id);
  const selo = getPowerSellerLabel(reputation.power_seller_status);
  const proximo = getProximoNivelLabel(reputation.power_seller_status);
  const t = reputation.transactions;
  const ratings = t?.ratings;
  const positivas = fmtPct01(ratings?.positive);
  const negativas = fmtPct01(ratings?.negative);
  const neutras = fmtPct01(ratings?.neutral);
  const metrics = reputation.metrics;

  const linhasMetricas = (Object.keys(METRIC_LABELS) as (keyof typeof METRIC_LABELS)[])
    .map((k) => ({ key: k, label: METRIC_LABELS[k], entry: metrics?.[k] }))
    .filter((l) => l.entry != null);

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <span className="panel-title">Reputação no Mercado Livre</span>
        <span className="panel-sub" style={{ color: nivel.cor, fontWeight: 700 }}>{nivel.label}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "var(--surface2)" }}>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Selo atual</div>
          <div style={{ fontSize: "1.15rem", fontWeight: 800 }}>{selo}</div>
        </div>
        {proximo && (
          <>
            <span style={{ color: "var(--muted)" }}>→</span>
            <div>
              <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Próximo degrau</div>
              <div style={{ fontSize: ".95rem", fontWeight: 700, color: "var(--accent)" }}>{proximo}</div>
            </div>
          </>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Vendas concluídas</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{t?.completed ?? "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Vendas canceladas</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, color: (t?.canceled ?? 0) > 0 ? "var(--red)" : undefined }}>{t?.canceled ?? "—"}</div>
        </div>
        {(positivas || negativas || neutras) && (
          <div>
            <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>Avaliações</div>
            <div style={{ fontSize: ".85rem", fontWeight: 700 }}>
              {positivas && <span style={{ color: "var(--green)" }}>{positivas} pos</span>}
              {negativas && <span style={{ color: "var(--red)", marginLeft: 8 }}>{negativas} neg</span>}
              {neutras && <span style={{ color: "var(--muted)", marginLeft: 8 }}>{neutras} neutra</span>}
            </div>
          </div>
        )}
      </div>

      {linhasMetricas.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: ".76rem", color: "var(--muted)", marginBottom: 6 }}>
            Métricas que o Mercado Livre usa pra calcular seu nível:
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {linhasMetricas.map(({ key, label, entry }) => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", fontSize: ".82rem", padding: "6px 10px", background: "var(--surface2)", borderRadius: 6 }}>
                <span>{label}{entry?.period ? <span style={{ color: "var(--muted)" }}> · {entry.period}</span> : null}</span>
                <span style={{ fontWeight: 700 }}>{fmtPct01(entry?.rate) ?? "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: ".7rem", color: "var(--muted)", lineHeight: 1.5 }}>
        O Mercado Livre não divulga publicamente os critérios exatos (nem o valor mínimo de faturamento) pra
        subir de selo — a tela &quot;O que falta para se tornar MercadoLíder&quot; só existe dentro do próprio
        Mercado Livre. Aqui mostramos o nível atual, o selo e as métricas reais que alimentam esse cálculo, sem
        inventar um checklist com números que não temos como confirmar.
      </div>
    </div>
  );
}
