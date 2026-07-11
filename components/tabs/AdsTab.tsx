"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";
import DateRangePicker from "@/components/dashboard/DateRangePicker";

type AdItem = {
  itemId: string; title: string; status: string;
  clicks: number; prints: number; ctr: number; cost: number;
  cpc: number; acos: number; cvr: number; sales: number; units: number; roas: number;
};
type Totals = {
  cost: number; clicks: number; prints: number; sales: number; units: number;
  ctr: number; cpc: number; acos: number; roas: number; cvr: number; anuncios: number;
};

function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const num = (n: number, d = 0) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const corRoas = (r: number) => (r >= 3 ? "var(--green)" : r >= 1.5 ? "var(--yellow)" : "var(--red)");
const corAcos = (a: number, temVenda: boolean) => (!temVenda ? "var(--muted)" : a <= 25 ? "var(--green)" : a <= 45 ? "var(--yellow)" : "var(--red)");

export default function AdsTab() {
  const [range, setRange] = useState(() => {
    const to = new Date();
    const from = new Date(Date.now() - 29 * 86400000);
    return { from: isoOf(from), to: isoOf(to) };
  });
  const [items, setItems] = useState<AdItem[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErro(null);
    try {
      const r = await authedFetch(`/api/ml/ads?from=${range.from}&to=${range.to}`, { cache: "no-store" });
      const j = await r.json();
      if (j.error) { setErro(j.diag ? JSON.stringify(j.diag, null, 2) : (j.details ?? j.error)); setItems([]); setTotals(null); }
      else { setItems(j.items ?? []); setTotals(j.totals ?? null); }
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const kpis = totals ? [
    { lbl: "💸 Investimento", val: fmtBRL(totals.cost), tone: "neg", sub: `${totals.anuncios} anúncio(s)` },
    { lbl: "💰 Receita (via ads)", val: fmtBRL(totals.sales), tone: "pos", sub: `${num(totals.units)} un vendidas` },
    { lbl: "📈 ROAS", val: `${num(totals.roas, 2)}x`, tone: "acc", sub: "receita ÷ investimento", cor: corRoas(totals.roas) },
    { lbl: "🎯 ACOS", val: `${num(totals.acos, 1)}%`, tone: "warn", sub: "investimento ÷ receita", cor: corAcos(totals.acos, totals.sales > 0) },
    { lbl: "👁️ Impressões", val: num(totals.prints), tone: "acc", sub: `CTR ${num(totals.ctr, 2)}%` },
    { lbl: "🖱️ Cliques", val: num(totals.clicks), tone: "acc", sub: `CPC ${fmtBRL(totals.cpc)}` },
  ] : [];

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>📢 Ads (Mercado Ads)</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={load} disabled={loading}>
            {loading ? "⏳ Carregando..." : "⟳ Atualizar"}
          </button>
        </div>
        <DateRangePicker from={range.from} to={range.to} onApply={(from, to) => setRange({ from, to })} />
      </div>

      {erro ? (
        <div style={{ padding: "12px 14px", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 8, fontSize: ".8rem", color: "var(--red)" }}>
          ⚠️ Não consegui puxar os Ads. Provável falta de permissão de Publicidade no token do ML (reconecte o ML concedendo <b>Mercado Ads</b>).
          <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", color: "var(--muted)", fontSize: ".7rem", maxHeight: 200, overflow: "auto" }}>{erro}</pre>
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            {kpis.map((k) => (
              <div key={k.lbl} className={`kpi k-${k.tone}`}>
                <div className="k-lbl">{k.lbl}</div>
                <div className="k-val" style={{ color: k.cor }}>{k.val}</div>
                <div className="k-sub">{k.sub}</div>
              </div>
            ))}
          </div>

          <div className="panel">
            <div className="panel-head" style={{ marginBottom: 8 }}>
              <span className="panel-title">📢 Desempenho por anúncio</span>
              <span className="panel-sub">ordenado por investimento · {range.from} → {range.to}</span>
            </div>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>⏳ Carregando…</div>
            ) : items.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Sem dados de Ads no período.</div>
            ) : (
              <div className="table-wrapper" style={{ border: "none" }}>
                <table className="tbl-modern">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Anúncio</th>
                      <th>Impressões</th><th>Cliques</th><th>CTR</th><th>CPC</th>
                      <th>Investido</th><th>Vendas</th><th>Un</th><th>ACOS</th><th>ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const temVenda = i.sales > 0;
                      const acos = i.sales > 0 ? (i.cost / i.sales) * 100 : 0;
                      const ctr = i.prints > 0 ? (i.clicks / i.prints) * 100 : 0;
                      const cpc = i.clicks > 0 ? i.cost / i.clicks : 0;
                      return (
                        <tr key={i.itemId}>
                          <td style={{ textAlign: "left", fontWeight: 600, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.title || i.itemId}>
                            {i.title || i.itemId}
                            <span style={{ display: "block", fontSize: ".68rem", color: "var(--muted)" }}>{i.itemId}</span>
                          </td>
                          <td style={{ color: "var(--muted)" }}>{num(i.prints)}</td>
                          <td style={{ color: "var(--muted)" }}>{num(i.clicks)}</td>
                          <td>{num(ctr, 2)}%</td>
                          <td style={{ color: "var(--muted)" }}>{fmtBRL(cpc)}</td>
                          <td style={{ color: "var(--red)", fontWeight: 600 }}>{fmtBRL(i.cost)}</td>
                          <td style={{ color: "var(--green)" }}>{fmtBRL(i.sales)}</td>
                          <td style={{ color: "var(--muted)" }}>{num(i.units)}</td>
                          <td style={{ color: corAcos(acos, temVenda), fontWeight: 700 }}>{temVenda ? `${num(acos, 1)}%` : "—"}</td>
                          <td style={{ color: corRoas(i.roas), fontWeight: 700 }}>{i.cost > 0 ? `${num(i.roas, 2)}x` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: ".72rem", color: "var(--muted)" }}>
              <b>ROAS</b> = receita ÷ investimento (maior = melhor) · <b>ACOS</b> = investimento ÷ receita (menor = melhor) · <b>CTR</b> = cliques ÷ impressões · <b>CPC</b> = custo por clique.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
