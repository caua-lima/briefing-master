"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtBRL } from "@/lib/domain/calc";
import { authedFetch } from "@/lib/api/authed-fetch";
import DateRangePicker from "@/components/dashboard/DateRangePicker";

type AdItem = {
  itemId: string; title: string;
  clicks: number; prints: number; cost: number;
  directSales: number; directUnits: number;
  adSales: number; adUnits: number;
  totalSales: number; totalUnits: number;
  lucroAntesAds: number; lucroLiquido: number;
};

type Modo = "pub" | "geral";

function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const num = (n: number, d = 0) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const corRoas = (r: number) => (r >= 3 ? "var(--green)" : r >= 1.5 ? "var(--yellow)" : "var(--red)");
const corAcos = (a: number, tem: boolean) => (!tem ? "var(--muted)" : a <= 25 ? "var(--green)" : a <= 45 ? "var(--yellow)" : "var(--red)");

export default function AdsTab() {
  const [range, setRange] = useState(() => ({ from: isoOf(new Date(Date.now() - 29 * 86400000)), to: isoOf(new Date()) }));
  const [modo, setModo] = useState<Modo>("pub");
  const [items, setItems] = useState<AdItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErro(null);
    try {
      const r = await authedFetch(`/api/ml/ads?from=${range.from}&to=${range.to}`, { cache: "no-store" });
      const j = await r.json();
      if (j.error) { setErro(j.diag ? JSON.stringify(j.diag, null, 2) : (j.details ?? j.error)); setItems([]); }
      else setItems(j.items ?? []);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const t = useMemo(() => items.reduce((a, i) => {
    a.cost += i.cost; a.clicks += i.clicks; a.prints += i.prints;
    a.direct += i.directSales; a.directUn += i.directUnits;
    a.adSales += i.adSales; a.total += i.totalSales; a.totalUn += i.totalUnits;
    a.lucroAntes += i.lucroAntesAds; a.lucroLiq += i.lucroLiquido;
    return a;
  }, { cost: 0, clicks: 0, prints: 0, direct: 0, directUn: 0, adSales: 0, total: 0, totalUn: 0, lucroAntes: 0, lucroLiq: 0 }), [items]);

  const pub = modo === "pub";
  // Valores do modo: vendas/unidades/roas/acos conforme "só ads" ou "geral"
  const vendasTot = pub ? t.direct : t.total;
  const unTot = pub ? t.directUn : t.totalUn;
  const roas = t.cost > 0 ? vendasTot / t.cost : 0;
  const acos = vendasTot > 0 ? (t.cost / vendasTot) * 100 : 0;
  const pctViaAds = t.total > 0 ? (t.adSales / t.total) * 100 : 0;

  const kpis = pub ? [
    { lbl: "💸 Investimento", val: fmtBRL(t.cost), tone: "neg", sub: `${items.length} anúncio(s)` },
    { lbl: "💰 Vendas diretas", val: fmtBRL(t.direct), tone: "pos", sub: `${num(t.directUn)} un via clique no ad` },
    { lbl: "📈 ROAS direto", val: `${num(roas, 2)}x`, tone: "acc", sub: "vendas diretas ÷ investido", cor: corRoas(roas) },
    { lbl: "🎯 ACOS direto", val: `${num(acos, 1)}%`, tone: "warn", sub: "investido ÷ vendas diretas", cor: corAcos(acos, t.direct > 0) },
    { lbl: "👁️ Impressões", val: num(t.prints), tone: "acc", sub: `CTR ${num(t.prints > 0 ? (t.clicks / t.prints) * 100 : 0, 2)}%` },
    { lbl: "🖱️ Cliques", val: num(t.clicks), tone: "acc", sub: `CPC ${fmtBRL(t.clicks > 0 ? t.cost / t.clicks : 0)}` },
    { lbl: "💵 Lucro após ads", val: fmtBRL(t.lucroLiq), tone: t.lucroLiq >= 0 ? "pos" : "neg", sub: t.lucroLiq >= 0 ? "vendas cobrem o ads ✅" : "ads não se paga ⚠️", cor: t.lucroLiq >= 0 ? "var(--green)" : "var(--red)" },
  ] : [
    { lbl: "💸 Investimento", val: fmtBRL(t.cost), tone: "neg", sub: `${items.length} anúncio(s)` },
    { lbl: "💰 Vendas totais", val: fmtBRL(t.total), tone: "pos", sub: `${num(t.totalUn)} un (todos os canais)` },
    { lbl: "📈 ROAS geral", val: `${num(roas, 2)}x`, tone: "acc", sub: "vendas totais ÷ investido", cor: corRoas(roas) },
    { lbl: "🎯 TACOS", val: `${num(acos, 1)}%`, tone: "warn", sub: "investido ÷ vendas totais", cor: corAcos(acos, t.total > 0) },
    { lbl: "🧲 Vendas via ads", val: `${num(pctViaAds, 0)}%`, tone: "acc", sub: `${fmtBRL(t.adSales)} vieram do ad` },
    { lbl: "🌱 Orgânico", val: `${num(100 - pctViaAds, 0)}%`, tone: "pos", sub: "vendas sem tráfego pago" },
    { lbl: "💵 Lucro após ads", val: fmtBRL(t.lucroLiq), tone: t.lucroLiq >= 0 ? "pos" : "neg", sub: t.lucroLiq >= 0 ? "vendas cobrem o ads ✅" : "ads não se paga ⚠️", cor: t.lucroLiq >= 0 ? "var(--green)" : "var(--red)" },
  ];

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>📢 Ads</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={load} disabled={loading}>
            {loading ? "⏳..." : "⟳ Atualizar"}
          </button>
        </div>
        <DateRangePicker from={range.from} to={range.to} onApply={(from, to) => setRange({ from, to })} />
      </div>

      {/* Toggle de análise */}
      <div className="seg" style={{ alignSelf: "flex-start" }}>
        <button type="button" className={`seg-btn ${pub ? "active" : ""}`} onClick={() => setModo("pub")}>📢 Publicidade (ads direto)</button>
        <button type="button" className={`seg-btn ${!pub ? "active" : ""}`} onClick={() => setModo("geral")}>🌐 Geral (todas as vendas)</button>
      </div>
      <div style={{ fontSize: ".78rem", color: "var(--muted)", marginTop: -6 }}>
        {pub
          ? "Só o que saiu direto do anúncio — mede a eficiência do ad em si."
          : "Quanto você gastou de ads vs TUDO que vendeu (inclui vendas sem tráfego pago) — o impacto real no faturamento."}
      </div>

      {erro ? (
        <div style={{ padding: "12px 14px", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 8, fontSize: ".8rem", color: "var(--red)" }}>
          ⚠️ Não consegui puxar os Ads (provável falta de permissão de <b>Mercado Ads</b> no token do ML — reconecte concedendo o acesso).
          <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", color: "var(--muted)", fontSize: ".7rem", maxHeight: 180, overflow: "auto" }}>{erro}</pre>
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
              <span className="panel-title">📢 Por anúncio — {pub ? "publicidade" : "geral"}</span>
              <span className="panel-sub">ordenado por investimento</span>
            </div>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>⏳ Carregando…</div>
            ) : items.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Sem dados de Ads no período.</div>
            ) : (
              <div className="table-wrapper" style={{ border: "none" }}>
                <table className="tbl-modern">
                  <thead>
                    {pub ? (
                      <tr><th style={{ textAlign: "left" }}>Anúncio</th><th>Impr.</th><th>Cliques</th><th>CTR</th><th>CPC</th><th>Investido</th><th>Vendas diretas</th><th>Un</th><th>ACOS</th><th>ROAS</th><th>💵 Lucro</th></tr>
                    ) : (
                      <tr><th style={{ textAlign: "left" }}>Anúncio</th><th>Investido</th><th>Vendas totais</th><th>Un</th><th>% via ads</th><th>TACOS</th><th>ROAS</th><th>💵 Lucro</th></tr>
                    )}
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const v = pub ? i.directSales : i.totalSales;
                      const un = pub ? i.directUnits : i.totalUnits;
                      const r = i.cost > 0 ? v / i.cost : 0;
                      const a = v > 0 ? (i.cost / v) * 100 : 0;
                      const ctr = i.prints > 0 ? (i.clicks / i.prints) * 100 : 0;
                      const cpc = i.clicks > 0 ? i.cost / i.clicks : 0;
                      const pctAds = i.totalSales > 0 ? (i.adSales / i.totalSales) * 100 : 0;
                      return (
                        <tr key={i.itemId}>
                          <td style={{ textAlign: "left", fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.title || i.itemId}>
                            {i.title || i.itemId}
                            <span style={{ display: "block", fontSize: ".66rem", color: "var(--muted)" }}>{i.itemId}</span>
                          </td>
                          {pub && <>
                            <td style={{ color: "var(--muted)" }}>{num(i.prints)}</td>
                            <td style={{ color: "var(--muted)" }}>{num(i.clicks)}</td>
                            <td>{num(ctr, 2)}%</td>
                            <td style={{ color: "var(--muted)" }}>{fmtBRL(cpc)}</td>
                          </>}
                          <td style={{ color: "var(--red)", fontWeight: 600 }}>{fmtBRL(i.cost)}</td>
                          <td style={{ color: "var(--green)" }}>{fmtBRL(v)}</td>
                          <td style={{ color: "var(--muted)" }}>{num(un)}</td>
                          {!pub && <td style={{ color: "var(--muted)" }}>{num(pctAds, 0)}%</td>}
                          <td style={{ color: corAcos(a, v > 0), fontWeight: 700 }}>{v > 0 ? `${num(a, 1)}%` : "—"}</td>
                          <td style={{ color: corRoas(r), fontWeight: 700 }}>{i.cost > 0 ? `${num(r, 2)}x` : "—"}</td>
                          <td style={{ color: i.lucroLiquido >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700, whiteSpace: "nowrap" }}>{fmtBRL(i.lucroLiquido)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: ".72rem", color: "var(--muted)" }}>
              {pub
                ? "Vendas diretas = compras logo após clicar no anúncio · ACOS/ROAS medem só o ad."
                : "Vendas totais = tudo que o item vendeu (ads + orgânico) · TACOS = investido ÷ vendas totais (quanto menor, mais o ads se paga no geral)."}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
