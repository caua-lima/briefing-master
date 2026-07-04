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
import RevenueLineChart from "./RevenueLineChart";
import ExpensesDoughnut from "./ExpensesDoughnut";
import GoalsProgressBars from "./GoalsProgressBars";
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

// ── Meta Diária ────────────────────────────────────────────────
function MetaDiariaCard({
  faturamentoHoje, pedidosHoje, metaDiaria,
}: {
  faturamentoHoje: number;
  pedidosHoje: number;
  metaDiaria: number | null;
}) {
  const pct = metaDiaria && metaDiaria > 0 ? Math.min((faturamentoHoje / metaDiaria) * 100, 100) : 0;
  const batida = metaDiaria ? faturamentoHoje >= metaDiaria : false;
  const falta = metaDiaria ? Math.max(metaDiaria - faturamentoHoje, 0) : 0;

  return (
    <div className="panel" style={{ borderColor: batida ? "var(--green)" : undefined }}>
      <div className="panel-title" style={{ marginBottom: 12 }}>📅 Meta Diária de Hoje</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <span style={{ fontSize: "1.6rem", fontWeight: 800, color: batida ? "var(--green)" : "var(--text)" }}>
          {fmtBRL(faturamentoHoje)}
        </span>
        {metaDiaria ? <span style={{ fontSize: ".85rem", color: "var(--muted)" }}>/ {fmtBRL(metaDiaria)}</span> : null}
      </div>
      {metaDiaria ? (
        <>
          <div className="dgoal-bar" style={{ marginBottom: 10 }}>
            <div className="dgoal-fill" style={{ width: `${pct}%`, background: batida ? "var(--green)" : "linear-gradient(90deg,#4f8ef7,#60a5fa)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".78rem", color: "var(--muted)" }}>
            <span>{pedidosHoje} pedido(s) hoje</span>
            <span style={{ color: batida ? "var(--green)" : undefined, fontWeight: 600 }}>
              {batida ? "✅ Meta batida!" : `Faltam ${fmtBRL(falta)}`}
            </span>
          </div>
        </>
      ) : (
        <div style={{ fontSize: ".8rem", color: "var(--muted)" }}>Configure uma meta diária na aba Metas.</div>
      )}
    </div>
  );
}

// ── Metas de Lucro Líquido ─────────────────────────────────────
function LucroMetasBars({
  lucroAtual, lucro1, lucro2, lucro3,
}: {
  lucroAtual: number;
  lucro1: number | null;
  lucro2: number | null;
  lucro3: number | null;
}) {
  const metas = [
    lucro1 ? { nome: "🥇 Lucro Meta 1", valor: lucro1, cor: "#4f8ef7" } : null,
    lucro2 ? { nome: "🥈 Lucro Meta 2", valor: lucro2, cor: "#f7c948" } : null,
    lucro3 ? { nome: "🥉 Lucro Meta 3", valor: lucro3, cor: "#a855f7" } : null,
  ].filter(Boolean) as { nome: string; valor: number; cor: string }[];

  if (!metas.length) return null;

  return (
    <div style={{ marginTop: 22 }}>
      <div className="panel-title" style={{ marginBottom: 12 }}>💰 Metas de Lucro Líquido</div>
      {metas.map((m) => {
        const pct = clamp((lucroAtual / m.valor) * 100, 0, 100);
        const done = lucroAtual >= m.valor;
        return (
          <div key={m.nome} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".8rem", marginBottom: 5 }}>
              <span style={{ color: done ? "var(--green)" : "var(--text)", fontWeight: 600 }}>{m.nome} {done ? "✓" : ""}</span>
              <span style={{ color: "var(--muted)" }}>{fmtBRL(lucroAtual)} / {fmtBRL(m.valor)}</span>
            </div>
            <div className="dgoal-bar">
              <div className="dgoal-fill" style={{ width: `${pct}%`, background: done ? "var(--green)" : m.cor }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Metas em Cascata ───────────────────────────────────────────
function MetasCascata({
  fatMes, projecao, meta1, meta2, meta3, label,
}: {
  fatMes: number; projecao: number; meta1: number;
  meta2: number | null; meta3: number | null; label?: string;
}) {
  const metas = [
    { valor: meta1, emoji: "🥇", nome: label || "Meta 1", cor: "#4f8ef7", corBg: "rgba(79,142,247,.13)" },
    ...(meta2 ? [{ valor: meta2, emoji: "🥈", nome: "Meta 2", cor: "#f7c948", corBg: "rgba(247,201,72,.13)" }] : []),
    ...(meta3 ? [{ valor: meta3, emoji: "🥉", nome: "Meta 3", cor: "#a855f7", corBg: "rgba(168,85,247,.13)" }] : []),
  ];
  const metasVisiveis: typeof metas = [];
  for (let i = 0; i < metas.length; i++) {
    metasVisiveis.push(metas[i]);
    if (fatMes < metas[i].valor) break;
  }
  const maxValor = metas[metas.length - 1].valor;
  const barraMax = Math.max(maxValor * 1.05, fatMes * 1.05, projecao * 1.05);
  const pctFat = Math.min((fatMes / barraMax) * 100, 100);
  const pctProj = Math.min((projecao / barraMax) * 100, 100);

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {metasVisiveis.map((m, i) => {
          const batida = fatMes >= m.valor;
          const ativa = !batida && (i === 0 || fatMes >= metas[i - 1].valor);
          return (
            <div key={m.nome} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "5px 12px",
              background: batida || ativa ? m.corBg : "var(--surface2)",
              border: `1px solid ${batida || ativa ? m.cor : "var(--border)"}`,
              borderRadius: 999, fontSize: ".78rem",
              opacity: batida || ativa ? 1 : 0.5, transition: "all .3s",
            }}>
              <span>{m.emoji}</span>
              <span style={{ fontWeight: 700, color: batida || ativa ? m.cor : "var(--muted)" }}>{m.nome}</span>
              <span style={{ color: "var(--muted)" }}>{fmtBRL(m.valor)}</span>
              {batida && <span style={{ color: m.cor, fontWeight: 800 }}>✓</span>}
              {ativa && !batida && <span style={{ color: m.cor, fontSize: ".7rem" }}>← em curso</span>}
            </div>
          );
        })}
        {metasVisiveis.length < metas.length && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6, padding: "5px 12px",
            background: "var(--surface2)", border: "1px solid var(--border)",
            borderRadius: 999, fontSize: ".78rem", opacity: 0.4,
          }}>
            <span>🔒</span>
            <span style={{ color: "var(--muted)" }}>
              {metas[metasVisiveis.length].nome} — desbloqueie batendo {metas[metasVisiveis.length - 1].nome}
            </span>
          </div>
        )}
      </div>

      <div style={{ position: "relative", height: 36, borderRadius: 999, background: "var(--surface2)", overflow: "visible", marginTop: 26 }}>
        {metasVisiveis.map((m) => {
          const pct = Math.min((m.valor / barraMax) * 100, 99.5);
          const batida = fatMes >= m.valor;
          return (
            <div key={m.valor} style={{
              position: "absolute", left: `${pct}%`, top: 0, bottom: 0,
              width: 2, background: m.cor, opacity: batida ? 1 : 0.5, zIndex: 3, borderRadius: 2,
            }}>
              <div style={{
                position: "absolute", bottom: "calc(100% + 4px)", left: "50%",
                transform: "translateX(-50%)", fontSize: ".65rem", color: m.cor,
                fontWeight: 700, whiteSpace: "nowrap", background: "var(--bg)",
                padding: "1px 4px", borderRadius: 4, border: `1px solid ${m.cor}`,
              }}>
                {m.emoji} {fmtBRL(m.valor)}
              </div>
            </div>
          );
        })}
        <div style={{
          position: "absolute", left: 0, top: "25%", height: "50%",
          width: `${pctProj}%`, background: "rgba(255,255,255,.06)",
          borderRadius: 999, border: "1px dashed rgba(255,255,255,.15)",
          zIndex: 1, transition: "width .5s ease",
        }} />
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${pctFat}%`,
          background: fatMes >= (meta3 ?? meta2 ?? meta1)
            ? "linear-gradient(90deg, #4f8ef7, #a855f7)"
            : fatMes >= (meta2 ?? meta1)
              ? "linear-gradient(90deg, #4f8ef7, #f7c948)"
              : "linear-gradient(90deg, #4f8ef7, #60a5fa)",
          borderRadius: 999, zIndex: 2, transition: "width .5s ease",
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          paddingRight: 10, minWidth: fatMes > 0 ? 60 : 0,
        }}>
          {fatMes > 0 && (
            <span style={{ fontSize: ".72rem", fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>{fmtBRL(fatMes)}</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".7rem", color: "var(--muted)", marginTop: 10, flexWrap: "wrap", gap: 4 }}>
        <div style={{ display: "flex", gap: 14 }}>
          <span>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#4f8ef7", marginRight: 4, verticalAlign: "middle" }} />
            Faturamento bruto
          </span>
          <span>
            <span style={{ display: "inline-block", width: 10, height: 4, borderRadius: 2, background: "rgba(255,255,255,.2)", marginRight: 4, verticalAlign: "middle", border: "1px dashed rgba(255,255,255,.3)" }} />
            Projeção ({fmtBRL(projecao)})
          </span>
        </div>
        {projecao >= meta1 && (
          <span style={{ color: "#4ade80", fontWeight: 600 }}>
            📈 Projeção bate {projecao >= (meta3 ?? meta2 ?? meta1) ? "a Meta 3!" : projecao >= (meta2 ?? meta1) ? "a Meta 2!" : "a Meta 1!"}
          </span>
        )}
      </div>
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
  const mountedRef = useRef(true);

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
        lucro1:      activeGoalEntry.lucro1 ?? null,
        lucro2:      activeGoalEntry.lucro2 ?? null,
        lucro3:      activeGoalEntry.lucro3 ?? null,
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

  const metaDiariaAtiva = goals?.metaDiaria ?? null;

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

          {/* Metas (mês) */}
          {periodoMode === "mes" && (
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">🎯 Metas — {formatMesBR(mes)}</span>
                <span className="panel-sub">Projeção de fechamento: {fmtBRL(projecao)}</span>
              </div>

              <div className="kpi-grid" style={{ marginBottom: 22 }}>
                <Kpi label="Faturamento do mês" value={fatBruto} tone="acc" />
                <Kpi label="Projeção" value={projecao} tone="pos" />
                <Kpi label="Lucro líquido do mês" value={lucroLiquido} tone={lucroLiquido >= 0 ? "pos" : "neg"} />
                <Kpi label="Margem do mês" value={mlMetrics?.margemComCustos ?? 0} tone="warn" isPct />
              </div>

              {goals?.meta1 ? (
                <MetasCascata
                  fatMes={fatBruto}
                  projecao={projecao}
                  meta1={goals.meta1}
                  meta2={goals.meta2 ?? null}
                  meta3={goals.meta3 ?? null}
                  label={goals.label}
                />
              ) : (
                <div style={{ color: "var(--muted)", fontSize: ".85rem" }}>Nenhuma meta configurada. Configure na aba Metas.</div>
              )}

              {goals && (goals.lucro1 || goals.lucro2 || goals.lucro3) && (
                <LucroMetasBars
                  lucroAtual={lucroLiquido}
                  lucro1={goals.lucro1 ?? null}
                  lucro2={goals.lucro2 ?? null}
                  lucro3={goals.lucro3 ?? null}
                />
              )}

              <div style={{ marginTop: 22 }}>
                <GoalsProgressBars goals={goals} days={[]} liveRevenue={fatBruto} />
              </div>
            </div>
          )}

          {/* Gráfico (mês) */}
          {periodoMode === "mes" && (
            <div className="panel">
              <div className="panel-title" style={{ marginBottom: 14 }}>📈 Evolução do Faturamento</div>
              <RevenueLineChart days={[]} windowDays={30} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
