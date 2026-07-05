"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { Goals } from "@/lib/domain/types";
import {
  fmtBRL,
  formatMesBR,
  mesAtual,
  diaAtualNoMes,
  diasNoMes,
  clamp,
} from "@/lib/domain/calc";
import type { UserData } from "@/components/useUserData";
import ExpensesDoughnut from "./ExpensesDoughnut";
import MetasGauge from "./MetasGauge";
import Gauge from "./Gauge";
import { authedFetch } from "@/lib/api/authed-fetch";

type Props = { data: UserData };

type AnuncioResult = {
  item_id:      string;
  title:        string;
  retorno:      number;
  custoProduto: number;
  envioFull:    number;
  imposto:      number;
  taxaML:       number;
  ads:          number;
  lucroBruto:   number;
  lucro:        number;
  margem:       number;
  qty:          number;
};

type HojeBreakdown = {
  faturamentoBruto: number;
  totalCMV:         number;
  totalAds:         number;
  totalEnvio:       number;
  totalTaxasML:     number;
  totalImposto:     number;
  lucroLiquido:     number;
  pedidos:          number;
};

type MlMetrics = {
  faturamentoBruto:   number;
  totalRetorno:       number;
  faturamentoHoje:    number;
  pedidosHoje:        number;
  ordersCount:        number;
  devolucoes:         number;
  totalCMV:           number;
  totalAds:           number;
  adsNaoVinculado:    number;
  totalEnvio:         number;
  totalImposto:       number;
  totalTaxasML:       number;
  custosOperacionais: number;
  lucroSemCustos:     number;
  lucroComCustos:     number;
  margemSemCustos:    number;
  margemComCustos:    number;
  anuncios:           AnuncioResult[];
  pedidosSemVinculo:  number;
  hoje:               HojeBreakdown;
  serieDiaria:        { data: string; faturamento: number }[];
  adsDiag?:           unknown;
  from:               string;
  to:                 string;
};

// cores usadas na composição de custos (batem com o doughnut)
const COST_COLORS = {
  cmv:  "rgba(99,102,241,.9)",
  full: "rgba(59,130,246,.9)",
  taxa: "rgba(245,158,11,.9)",
  imp:  "rgba(234,179,8,.9)",
  ads:  "rgba(239,68,68,.9)",
  op:   "rgba(167,139,250,.9)",
};

// throttle da sincronização automática (compartilhado entre montagens)
let lastAutoSync = 0;

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayISO(): string {
  return isoOf(new Date());
}
function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoOf(d);
}
function weekRange(): { from: string; to: string } {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(now.setDate(diff));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: isoOf(mon), to: isoOf(sun) };
}
function monthRange(mes: string): { from: string; to: string } {
  const [y, m] = mes.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  const ld = String(last).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${ld}` };
}

// ── KPI ────────────────────────────────────────────────────────
function Kpi({
  label, value, tone, isPct, sub,
}: {
  label: string;
  value: number;
  tone: "pos" | "neg" | "acc" | "warn";
  isPct?: boolean;
  sub?: string;
}) {
  const color =
    tone === "pos" ? "var(--green)" :
    tone === "neg" ? "var(--red)" :
    tone === "warn" ? "var(--yellow)" : "var(--text)";
  return (
    <div className={`kpi k-${tone}`}>
      <div className="k-lbl">{label}</div>
      <div className="k-val" style={{ color }}>
        {isPct ? `${value.toFixed(1)}%` : fmtBRL(value)}
      </div>
      {sub && <div className="k-sub">{sub}</div>}
    </div>
  );
}

// ── Vendas do Dia (hero) ───────────────────────────────────────
function VendasDoDiaHero({ hoje }: { hoje?: HojeBreakdown }) {
  const h: HojeBreakdown = hoje ?? {
    faturamentoBruto: 0, totalCMV: 0, totalAds: 0, totalEnvio: 0,
    totalTaxasML: 0, totalImposto: 0, lucroLiquido: 0, pedidos: 0,
  };
  const margem = h.faturamentoBruto > 0 ? (h.lucroLiquido / h.faturamentoBruto) * 100 : 0;

  const stats: { label: string; icon: string; value: number; color: string }[] = [
    { label: "Faturamento bruto", icon: "💵", value: h.faturamentoBruto, color: "var(--green)" },
    { label: "CMV (produto)",     icon: "📦", value: h.totalCMV,         color: "var(--red)" },
    { label: "Gasto com ADS",     icon: "📢", value: h.totalAds,         color: "var(--red)" },
    { label: "Lucro líquido",     icon: "✅", value: h.lucroLiquido,     color: h.lucroLiquido >= 0 ? "var(--green)" : "var(--red)" },
  ];

  return (
    <section className="hero">
      <div className="hero-head">
        <span className="hero-title">⚡ Vendas do Dia</span>
        <span className="hero-badge">
          {h.pedidos} pedido(s) · margem <b style={{ color: margem >= 0 ? "var(--green)" : "var(--red)" }}>{margem.toFixed(1)}%</b>
        </span>
      </div>
      <div className="hero-grid">
        {stats.map((s) => (
          <div key={s.label} className="hero-stat">
            <div className="lbl">{s.icon} {s.label}</div>
            <div className="val" style={{ color: s.color }}>{fmtBRL(s.value)}</div>
          </div>
        ))}
      </div>
      <div className="hero-foot">Lucro líquido = retorno − CMV − ADS − Full − taxas ML − imposto</div>
    </section>
  );
}

// ── Meta Diária (velocímetro) ──────────────────────────────────
function MetaDiariaCard({
  faturamentoHoje, pedidosHoje, metaDiaria,
}: {
  faturamentoHoje: number;
  pedidosHoje: number;
  metaDiaria: number | null;
}) {
  const pct = metaDiaria && metaDiaria > 0 ? clamp((faturamentoHoje / metaDiaria) * 100, 0, 100) : 0;
  const batida = metaDiaria ? faturamentoHoje >= metaDiaria : false;
  const falta = metaDiaria ? Math.max(metaDiaria - faturamentoHoje, 0) : 0;

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
      {metaDiaria ? (
        <Gauge
          caption="📅 Meta Diária de Hoje"
          pct={pct}
          centerText={`${pct.toFixed(0)}%`}
          leftLabel="R$ 0"
          rightLabel={fmtBRL(metaDiaria)}
          footer={
            <>
              <b style={{ color: "var(--text)" }}>{fmtBRL(faturamentoHoje)}</b> · {pedidosHoje} pedido(s) ·{" "}
              <span style={{ color: batida ? "var(--green)" : "var(--muted)" }}>
                {batida ? "✅ batida!" : `faltam ${fmtBRL(falta)}`}
              </span>
            </>
          }
        />
      ) : (
        <>
          <div className="panel-title" style={{ marginBottom: 8 }}>📅 Meta Diária de Hoje</div>
          <div style={{ fontSize: ".8rem", color: "var(--muted)" }}>Configure uma meta (Meta 1) na aba Metas.</div>
        </>
      )}
    </div>
  );
}

// ── Tabela de Lucro por Anúncio ────────────────────────────────
function TabelaAnuncios({ anuncios, adsNaoVinculado }: { anuncios: AnuncioResult[]; adsNaoVinculado: number }) {
  if (!anuncios.length) {
    return (
      <div style={{ color: "var(--muted)", fontSize: ".85rem", padding: "16px 0", textAlign: "center" }}>
        Nenhum anúncio vinculado no período. Cadastre os produtos (SKU/MLB) no Estoque.
      </div>
    );
  }
  const sum = (f: (a: AnuncioResult) => number) => anuncios.reduce((s, a) => s + f(a), 0);
  const totalRet = sum((a) => a.retorno);
  const totalBruto = sum((a) => a.lucroBruto);
  const totalLucro = sum((a) => a.lucro);
  const margemTotal = totalRet > 0 ? (totalLucro / totalRet) * 100 : 0;
  const margemTag = (m: number) => (m >= 20 ? "tag-g" : m >= 10 ? "tag-y" : "tag-r");

  return (
    <div className="table-wrapper" style={{ border: "none" }}>
      <table className="tbl-modern">
        <thead>
          <tr>
            <th>Anúncio</th><th>Qtd</th><th>Retorno</th><th>CMV</th><th>Envio Full</th>
            <th>Taxa ML</th><th>Imposto</th><th>ADS</th><th>Lucro Bruto</th><th>Lucro Líq.</th><th>Margem</th>
          </tr>
        </thead>
        <tbody>
          {anuncios.map((a) => (
            <tr key={a.item_id}>
              <td>
                <span title={a.title} style={{ fontWeight: 600 }}>{a.title}</span>
                {a.item_id && <span style={{ display: "block", fontSize: ".7rem", color: "var(--muted)" }}>{a.item_id}</span>}
              </td>
              <td style={{ color: "var(--muted)" }}>{a.qty}</td>
              <td style={{ color: "var(--green)", fontWeight: 600 }}>{fmtBRL(a.retorno)}</td>
              <td style={{ color: "var(--red)" }}>{fmtBRL(a.custoProduto)}</td>
              <td style={{ color: "var(--red)" }}>{fmtBRL(a.envioFull)}</td>
              <td style={{ color: "var(--red)" }}>{fmtBRL(a.taxaML)}</td>
              <td style={{ color: "var(--red)" }}>{fmtBRL(a.imposto)}</td>
              <td style={{ color: "var(--red)" }}>{fmtBRL(a.ads)}</td>
              <td style={{ color: a.lucroBruto >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(a.lucroBruto)}</td>
              <td style={{ fontWeight: 700, color: a.lucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(a.lucro)}</td>
              <td><span className={`tag ${margemTag(a.margem)}`}>{a.margem.toFixed(1)}%</span></td>
            </tr>
          ))}
          {adsNaoVinculado > 0.01 && (
            <tr>
              <td style={{ color: "var(--muted)", fontStyle: "italic" }}>
                ADS de itens sem venda no período
              </td>
              <td colSpan={6}></td>
              <td style={{ color: "var(--red)" }}>{fmtBRL(adsNaoVinculado)}</td>
              <td></td><td style={{ color: "var(--red)" }}>−{fmtBRL(adsNaoVinculado)}</td><td></td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td style={{ color: "var(--muted)" }}>{sum((a) => a.qty)}</td>
            <td style={{ color: "var(--green)" }}>{fmtBRL(totalRet)}</td>
            <td style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.custoProduto))}</td>
            <td style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.envioFull))}</td>
            <td style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.taxaML))}</td>
            <td style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.imposto))}</td>
            <td style={{ color: "var(--red)" }}>{fmtBRL(sum((a) => a.ads) + Math.max(adsNaoVinculado, 0))}</td>
            <td style={{ color: totalBruto >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(totalBruto)}</td>
            <td style={{ color: (totalLucro - adsNaoVinculado) >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(totalLucro - adsNaoVinculado)}</td>
            <td><span className={`tag ${margemTag(margemTotal)}`}>{margemTotal.toFixed(1)}%</span></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Dashboard principal ────────────────────────────────────────
export default function Dashboard({ data }: Props) {
  const mes = mesAtual();

  type PeriodoMode = "hoje" | "ontem" | "3d" | "7d" | "semana" | "mes" | "custom";
  const [periodoMode, setPeriodoMode] = useState<PeriodoMode>("mes");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [mlRefreshing, setMlRefreshing] = useState(false);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlMetrics, setMlMetrics] = useState<MlMetrics | null>(null);
  const [mlAccount, setMlAccount] = useState<{ user?: { nickname?: string; site_id?: string } } | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const mountedRef = useRef(true);

  function runDiagAds() {
    const d = mlMetrics?.adsDiag;
    setDiag(d ? JSON.stringify(d, null, 2) : "Sem diagnóstico disponível (ADS pode estar OK ou período sem dados).");
  }

  const periodoRange = useMemo((): { from: string; to: string } => {
    const today = todayISO();
    if (periodoMode === "hoje") return { from: today, to: today };
    if (periodoMode === "ontem") return { from: daysAgoISO(1), to: daysAgoISO(1) };
    if (periodoMode === "3d") return { from: daysAgoISO(2), to: today };
    if (periodoMode === "7d") return { from: daysAgoISO(6), to: today };
    if (periodoMode === "semana") return weekRange();
    if (periodoMode === "mes") return monthRange(mes);
    if (customFrom && customTo) return { from: customFrom, to: customTo };
    return monthRange(mes);
  }, [periodoMode, customFrom, customTo, mes]);

  const fetchMetrics = useCallback(async (from: string, to: string) => {
    setMlLoading(true);
    try {
      const res = await authedFetch(`/api/ml/metrics?from=${from}&to=${to}`, { cache: "no-store" });
      if (!res.ok) { setMlMetrics(null); return; }
      const json = await res.json();
      if (mountedRef.current) setMlMetrics(json);
    } catch {
      if (mountedRef.current) setMlMetrics(null);
    } finally {
      if (mountedRef.current) setMlLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    fetchMetrics(periodoRange.from, periodoRange.to);
  }, [periodoRange, fetchMetrics]);

  useEffect(() => {
    authedFetch("/api/ml/account", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (mountedRef.current) setMlAccount(j); })
      .catch(() => {});
  }, []);

  // Sincronização automática ao abrir (mantém "hoje" e o mês sempre atualizados)
  useEffect(() => {
    if (Date.now() - lastAutoSync < 5 * 60 * 1000) return;
    lastAutoSync = Date.now();
    (async () => {
      setMlRefreshing(true);
      try {
        await authedFetch("/api/ml/sync-all", { method: "POST" });
        if (mountedRef.current) await fetchMetrics(periodoRange.from, periodoRange.to);
      } catch { /* silencioso */ }
      finally { if (mountedRef.current) setMlRefreshing(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRefreshML() {
    setMlRefreshing(true);
    try {
      await authedFetch("/api/ml/sync-all", { method: "POST" });
      await fetchMetrics(periodoRange.from, periodoRange.to);
    } catch (e) { console.error(e); }
    finally { setMlRefreshing(false); }
  }

  // ── Metas ────────────────────────────────────────────────
  const activeGoalEntry = data.goalEntries.find((e) => e.mes === mes) ?? data.goalEntries[0] ?? null;
  const goals: Goals | null = activeGoalEntry
    ? {
        mes:         activeGoalEntry.mes,
        meta1:       activeGoalEntry.meta1,
        meta2:       activeGoalEntry.meta2 ?? null,
        meta3:       activeGoalEntry.meta3 ?? null,
        metaMargem:  activeGoalEntry.metaMargem ?? 10,
        metaDiaria:  activeGoalEntry.metaDiaria ?? null,
        meta2Diaria: activeGoalEntry.meta2Diaria ?? null,
        meta3Diaria: activeGoalEntry.meta3Diaria ?? null,
        label:       activeGoalEntry.label,
      }
    : data.goals;

  const fatBruto = mlMetrics?.faturamentoBruto ?? 0;
  const retorno = mlMetrics?.totalRetorno ?? 0;
  const lucroLiquido = mlMetrics?.lucroComCustos ?? 0;

  const projecao = useMemo(() => {
    if (periodoMode !== "mes" || !mlMetrics) return 0;
    const diaAtual = diaAtualNoMes();
    const totalDias = diasNoMes(mes);
    if (diaAtual <= 0) return 0;
    return (fatBruto / diaAtual) * totalDias;
  }, [periodoMode, mlMetrics, fatBruto, mes]);

  // Meta diária automática = meta mensal (Meta 1) ÷ dias do mês
  const metaDiariaAtiva = goals?.meta1 ? goals.meta1 / diasNoMes(mes) : null;

  const PERIOD_LABELS: Record<PeriodoMode, string> = {
    hoje: "Hoje", ontem: "Ontem", "3d": "3 dias", "7d": "7 dias",
    semana: "Semana", mes: "Mês", custom: "Personalizado",
  };

  const totalCustos =
    (mlMetrics?.totalCMV ?? 0) + (mlMetrics?.totalEnvio ?? 0) + (mlMetrics?.totalTaxasML ?? 0) +
    (mlMetrics?.totalImposto ?? 0) + (mlMetrics?.totalAds ?? 0) + (mlMetrics?.custosOperacionais ?? 0);

  const custoRows: { label: string; value: number; color: string }[] = [
    { label: "CMV (custo do produto)", value: mlMetrics?.totalCMV ?? 0, color: COST_COLORS.cmv },
    { label: "Envio Full", value: mlMetrics?.totalEnvio ?? 0, color: COST_COLORS.full },
    { label: "Taxas ML (comissão)", value: mlMetrics?.totalTaxasML ?? 0, color: COST_COLORS.taxa },
    { label: "Imposto sobre venda", value: mlMetrics?.totalImposto ?? 0, color: COST_COLORS.imp },
    { label: "ADS (publicidade)", value: mlMetrics?.totalAds ?? 0, color: COST_COLORS.ads },
    { label: "Custos operacionais", value: mlMetrics?.custosOperacionais ?? 0, color: COST_COLORS.op },
  ];

  return (
    <div className="dash">
      {/* ── Topbar ── */}
      <div className="dash-top">
        <div className="dash-top-left">
          <span className="acct-chip">
            <span className="acct-dot" /> Conta ML <b>{mlAccount?.user?.nickname ?? "—"}</b>
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={handleRefreshML} disabled={mlRefreshing} style={{ opacity: mlRefreshing ? 0.6 : 1 }}>
            {mlRefreshing ? "⏳ Sincronizando..." : "⟳ Atualizar ML"}
          </button>
          {(mlMetrics && mlMetrics.totalAds === 0) && (
            <button type="button" className="btn btn-xs btn-ghost" onClick={runDiagAds} title="Diagnóstico do ADS">🐞 ADS</button>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="seg">
            {(["hoje", "ontem", "3d", "7d", "semana", "mes", "custom"] as PeriodoMode[]).map((mode) => (
              <button key={mode} type="button" className={`seg-btn ${periodoMode === mode ? "active" : ""}`} onClick={() => setPeriodoMode(mode)}>
                {PERIOD_LABELS[mode]}
              </button>
            ))}
          </div>
          {periodoMode === "custom" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="date" className="date-input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <span style={{ color: "var(--muted)", fontSize: ".8rem" }}>até</span>
              <input type="date" className="date-input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {diag && (
        <pre style={{
          position: "relative", background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "12px 14px", fontSize: ".72rem", maxHeight: 300, overflow: "auto",
          whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text)",
        }}>
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => setDiag(null)} style={{ position: "absolute", right: 8, top: 8 }}>✕</button>
          {diag}
        </pre>
      )}

      {mlMetrics && mlMetrics.totalAds === 0 && (() => {
        const d = mlMetrics.adsDiag as { advertisersStatus?: number; advertiserId?: unknown } | null;
        const blocked = !!d && (d.advertisersStatus === 401 || d.advertisersStatus === 403 || d.advertiserId == null);
        if (!blocked) return null;
        return (
          <div style={{ padding: "10px 14px", background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.35)", borderRadius: 8, fontSize: ".82rem", color: "#f7c948" }}>
            ⚠️ <b>ADS não autorizado (HTTP {d?.advertisersStatus ?? "—"}).</b> O token do Mercado Livre não tem permissão de Publicidade.{" "}
            Reconecte o ML em <b>Trocar conta ML</b> concedendo acesso a <b>Publicidade / Mercado Ads</b> para o gasto com Ads voltar a aparecer.
          </div>
        );
      })()}

      {/* ── Conteúdo ── */}
      {mlLoading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--muted)" }}>⏳ Carregando dados…</div>
      ) : (
        <>
          {/* Vendas do dia */}
          <VendasDoDiaHero hoje={mlMetrics?.hoje} />

          {/* Resultado do período */}
          <section>
            <div className="panel-head">
              <span className="panel-title">💰 Resultado do período</span>
              {mlMetrics && <span className="panel-sub">{mlMetrics.from} → {mlMetrics.to} · {PERIOD_LABELS[periodoMode]}</span>}
            </div>
            <div className="kpi-grid">
              <Kpi label="Faturamento bruto" value={fatBruto} tone="acc" />
              <Kpi label="Retorno sobre vendas" value={retorno} tone="acc" />
              <Kpi label="Lucro líquido" value={lucroLiquido} tone={lucroLiquido >= 0 ? "pos" : "neg"} sub="já com custos operacionais" />
              <Kpi label="Margem líquida" value={mlMetrics?.margemComCustos ?? 0} tone="warn" isPct />
              <Kpi label="Gasto com ADS" value={mlMetrics?.totalAds ?? 0} tone="neg" />
              <Kpi label="Devoluções" value={mlMetrics?.devolucoes ?? 0} tone="neg" />
            </div>
          </section>

          {/* Meta diária + Pedidos */}
          <div className="dash-2col">
            <MetaDiariaCard
              faturamentoHoje={mlMetrics?.faturamentoHoje ?? 0}
              pedidosHoje={mlMetrics?.pedidosHoje ?? 0}
              metaDiaria={metaDiariaAtiva}
            />
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: 12 }}>📦 Pedidos</div>
              <div className="stat-row"><span className="s-lbl">Pedidos no período</span><span className="s-val">{mlMetrics?.ordersCount ?? 0}</span></div>
              <div className="stat-row"><span className="s-lbl">Sem produto vinculado</span><span className="s-val" style={{ color: (mlMetrics?.pedidosSemVinculo ?? 0) > 0 ? "var(--yellow)" : undefined }}>{mlMetrics?.pedidosSemVinculo ?? 0}</span></div>
              <div className="stat-row"><span className="s-lbl">Ticket médio</span><span className="s-val">{(mlMetrics?.ordersCount ?? 0) > 0 ? fmtBRL(fatBruto / mlMetrics!.ordersCount) : "—"}</span></div>
              {(mlMetrics?.pedidosSemVinculo ?? 0) > 0 && (
                <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(247,201,72,.1)", border: "1px solid rgba(247,201,72,.3)", borderRadius: 8, fontSize: ".76rem", color: "#f7c948" }}>
                  ⚠️ {mlMetrics?.pedidosSemVinculo} pedido(s) sem produto vinculado — cadastre o SKU/MLB no Estoque.
                </div>
              )}
            </div>
          </div>

          {/* Composição de custos + Doughnut */}
          <div className="dash-2col">
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: 14 }}>📊 Composição de Custos</div>
              {custoRows.map((r) => (
                <div key={r.label} className="cost-row">
                  <span className="c-lbl"><span className="cost-dot" style={{ background: r.color }} />{r.label}</span>
                  <span style={{ color: "var(--red)", fontWeight: 700 }}>{fmtBRL(r.value)}</span>
                </div>
              ))}
              <div className="cost-total">
                <span>Total de custos</span>
                <span style={{ color: "var(--red)" }}>{fmtBRL(totalCustos)}</span>
              </div>
            </div>
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: 14 }}>🥧 Distribuição dos Gastos</div>
              <ExpensesDoughnut
                produto={mlMetrics?.totalCMV ?? 0}
                envio={mlMetrics?.totalEnvio ?? 0}
                taxasML={mlMetrics?.totalTaxasML ?? 0}
                imposto={mlMetrics?.totalImposto ?? 0}
                ads={mlMetrics?.totalAds ?? 0}
                operacional={mlMetrics?.custosOperacionais ?? 0}
              />
            </div>
          </div>

          {/* Lucro por anúncio */}
          <div className="panel">
            <div className="panel-head" style={{ marginBottom: 8 }}>
              <span className="panel-title">📢 Lucro por Anúncio</span>
            </div>
            <div style={{ fontSize: ".76rem", color: "var(--muted)", marginBottom: 14 }}>
              Lucro líq. = Retorno − CMV − Envio Full − Taxa ML − Imposto − ADS · valores puxados do Mercado Livre
            </div>
            <TabelaAnuncios anuncios={mlMetrics?.anuncios ?? []} adsNaoVinculado={mlMetrics?.adsNaoVinculado ?? 0} />
          </div>

          {/* Acompanhamento das metas (mês) — painel com velocímetro */}
          {periodoMode === "mes" && (
            <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="panel-head" style={{ marginBottom: 0 }}>
                <span className="panel-title">🎯 Acompanhamento das Metas — {formatMesBR(mes)}</span>
                <span className="panel-sub">Projeção de fechamento: {fmtBRL(projecao)}</span>
              </div>

              {goals?.meta1 ? (
                <MetasGauge
                  fatBruto={fatBruto}
                  meta1={goals.meta1}
                  meta2={goals.meta2 ?? null}
                  meta3={goals.meta3 ?? null}
                  projecao={projecao}
                  diaAtual={diaAtualNoMes()}
                  totalDias={diasNoMes(mes)}
                  margemAtual={mlMetrics?.margemComCustos ?? 0}
                  metaMargem={goals.metaMargem ?? 10}
                />
              ) : (
                <div className="panel" style={{ color: "var(--muted)", fontSize: ".85rem" }}>
                  Nenhuma meta configurada. Configure na aba Metas.
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
