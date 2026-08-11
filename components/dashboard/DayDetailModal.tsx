"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { fmtBRL, formatDateLong } from "@/lib/domain/calc";

type DayMetrics = {
  faturamentoLiquido: number;
  lucroComCustos: number;
  margemComCustos: number;
  ordersCount: number;
  totalAds: number;
  adsFalhou?: boolean;
};

/**
 * Detalhamento de um único dia, aberto ao clicar num ponto do gráfico de
 * tendência. Reaproveita a MESMA rota de métricas que o resto do Dashboard já
 * usa (só com from=to=o dia clicado) — nenhum cálculo novo, nenhuma rota nova.
 */
export default function DayDetailModal({ date, onClose }: { date: string; onClose: () => void }) {
  const [dados, setDados] = useState<DayMetrics | null>(null);
  const [erro, setErro] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErro(false);
    authedFetch(`/api/ml/metrics?from=${date}&to=${date}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (alive) setDados(j); })
      .catch(() => { if (alive) setErro(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [date]);

  return (
    <div className="modal-overlay active" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title" style={{ textAlign: "left" }}>{formatDateLong(date)}</div>
        {loading ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-secondary)", fontSize: ".85rem" }}>Carregando…</div>
        ) : erro || !dados ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-secondary)", fontSize: ".85rem" }}>Não consegui carregar este dia agora.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            <Linha label="Faturamento líquido" value={fmtBRL(dados.faturamentoLiquido)} />
            <Linha label="Lucro líquido" value={fmtBRL(dados.lucroComCustos)} tone={dados.lucroComCustos >= 0 ? "pos" : "neg"} />
            <Linha label="Margem líquida" value={`${dados.margemComCustos.toFixed(1)}%`} />
            <Linha label="Pedidos" value={String(dados.ordersCount)} />
            <Linha label="Gasto com ADS" value={dados.adsFalhou ? "indisponível" : fmtBRL(dados.totalAds)} />
          </div>
        )}
        <div className="modal-btns">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function Linha({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: ".88rem" }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="money" style={{ fontWeight: 700, color: tone === "pos" ? "var(--success)" : tone === "neg" ? "var(--danger)" : "var(--text-primary)" }}>{value}</span>
    </div>
  );
}
