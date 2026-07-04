"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { Goals } from "@/lib/domain/types";
import {
  fmtBRL,
  formatMesBR,
  mesAtual,
  diaAtualNoMes,
  diasNoMes,
} from "@/lib/domain/calc";
import type { UserData } from "@/components/useUserData";
import KpiCard from "./KpiCard";
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

type MlMetrics = {
  faturamentoBruto:   number;
  totalRetorno:       number;
  faturamentoHoje:    number;
  pedidosHoje:        number;
  ordersCount:        number;
  devolucoes:         number;
  totalCMV:           number;
  totalAds:           number;
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
  from:               string;
  to:                 string;
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
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: fmt(mon), to: fmt(sun) };
}

function monthRange(mes: string): { from: string; to: string } {
  const [y, m] = mes.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  const ld = String(last).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${ld}` };
}

// ── Meta Diária Card ───────────────────────────────────────────
function MetaDiariaCard({
  faturamentoHoje,
  pedidosHoje,
  metaDiaria,
}: {
  faturamentoHoje: number;
  pedidosHoje: number;
  metaDiaria: number | null;
}) {
  const pct = metaDiaria && metaDiaria > 0
    ? Math.min((faturamentoHoje / metaDiaria) * 100, 100)
    : 0;
  const batida = metaDiaria ? faturamentoHoje >= metaDiaria : false;
  const falta  = metaDiaria ? Math.max(metaDiaria - faturamentoHoje, 0) : 0;

  return (
    <div style={{
      background: "var(--surface2)", border: `1px solid ${batida ? "var(--green)" : "var(--border)"}`,
      borderRadius: 10, padding: "14px 16px", flex: 1, minWidth: 220,
    }}>
      <div style={{ fontSize: ".7rem", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>
        📅 Meta Diária de Hoje
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: "1.3rem", fontWeight: 800, color: batida ? "var(--green)" : "var(--text)" }}>
          {fmtBRL(faturamentoHoje)}
        </span>
        {metaDiaria && (
          <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>
            / {fmtBRL(metaDiaria)}
          </span>
        )}
      </div>
      {metaDiaria && (
        <>
          <div style={{ height: 8, borderRadius: 999, background: "var(--surface)", overflow: "hidden", marginBottom: 8 }}>
            <div style={{
              height: "100%", borderRadius: 999, transition: "width .5s ease",
              width: `${pct}%`,
              background: batida ? "var(--green)" : "linear-gradient(90deg, #4f8ef7, #60a5fa)",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".75rem", color: "var(--muted)" }}>
            <span>{pedidosHoje} pedido(s) hoje</span>
            <span style={{ color: batida ? "var(--green)" : undefined }}>
              {batida ? "✅ Meta batida!" : `Faltam ${fmtBRL(falta)}`}
            </span>
          </div>
        </>
      )}
      {!metaDiaria && (
        <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>
          Configure uma meta diária na aba Metas
        </div>
      )}
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
  const pctFat  = Math.min((fatMes  / barraMax) * 100, 100);
  const pctProj = Math.min((projecao / barraMax) * 100, 100);

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        {metasVisiveis.map((m, i) => {
          const batida = fatMes >= m.valor;
          const ativa  = !batida && (i === 0 || fatMes >= metas[i - 1].valor);
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

      <div style={{ position: "relative", height: 36, borderRadius: 999, background: "var(--surface2)", overflow: "visible" }}>
        {metasVisiveis.map((m) => {
          const pct    = Math.min((m.valor / barraMax) * 100, 99.5);
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
            <span style={{ fontSize: ".72rem", fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>
              {fmtBRL(fatMes)}
            </span>
          )}
        </div>
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: ".7rem", color: "var(--muted)", marginTop: 8, flexWrap: "wrap", gap: 4,
      }}>
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
function TabelaAnuncios({ anuncios }: { anuncios: AnuncioResult[] }) {
  if (!anuncios.length) {
    return (
      <div style={{ color: "var(--muted)", fontSize: ".82rem", padding: "8px 0" }}>
        Nenhum anúncio vinculado no período. Corrija os SKUs no Estoque.
      </div>
    );
  }
  const th = { padding: "6px 10px", color: "var(--muted)", fontWeight: 600, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" as const };
  const thR = { ...th, textAlign: "right" as const };
  const sum = (f: (a: AnuncioResult) => number) => anuncios.reduce((s, a) => s + f(a), 0);
  const totalRet    = sum((a) => a.retorno);
  const totalBruto  = sum((a) => a.lucroBruto);
  const totalLucro  = sum((a) => a.lucro);
  const margemTotal = totalRet > 0 ? (totalLucro / totalRet) * 100 : 0;

  return (
    <div className="table-wrapper" style={{ marginTop: 4, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Anúncio</th>
            <th style={thR}>Qtd</th>
            <th style={thR}>Retorno</th>
            <th style={thR}>CMV</th>
            <th style={thR}>Envio Full</th>
            <th style={thR}>Taxa ML</th>
            <th style={thR}>Imposto</th>
            <th style={thR}>ADS</th>
            <th style={thR}>Lucro Bruto</th>
            <th style={thR}>Lucro Líq.</th>
            <th style={thR}>Margem</th>
          </tr>
        </thead>
        <tbody>
          {anuncios.map((a) => (
            <tr key={a.item_id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "8px 10px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span title={a.title} style={{ fontWeight: 600 }}>{a.title}</span>
                {a.item_id && (
                  <span style={{ display: "block", fontSize: ".7rem", color: "var(--muted)" }}>{a.item_id}</span>
                )}
              </td>
              <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--muted)" }}>{a.qty}</td>
              <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--green)", fontWeight: 600 }}>{fmtBRL(a.retorno)}</td>
              <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--red)" }}>{fmtBRL(a.custoProduto)}</td>
              <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--red)" }}>{fmtBRL(a.envioFull)}</td>
              <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--red)" }}>{fmtBRL(a.taxaML)}</td>
              <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--red)" }}>{fmtBRL(a.imposto)}</td>
              <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--red)" }}>{fmtBRL(a.ads)}</td>
              <td style={{ textAlign: "right", padding: "8px 10px", color: a.lucroBruto >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(a.lucroBruto)}</td>
              <td style={{ textAlign: "right", padding: "8px 10px", fontWeight: 700, color: a.lucro >= 0 ? "var(--green)" : "var(--red)" }}>
                {fmtBRL(a.lucro)}
              </td>
              <td style={{ textAlign: "right", padding: "8px 10px" }}>
                <span style={{
                  fontWeight: 700,
                  color: a.margem >= 20 ? "var(--green)" : a.margem >= 10 ? "#f7c948" : "var(--red)",
                }}>
                  {a.margem.toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid var(--border)", background: "var(--surface2)" }}>
            <td style={{ padding: "8px 10px", fontWeight: 700 }}>Total</td>
            <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--muted)", fontWeight: 700 }}>{sum((a) => a.qty)}</td>
            <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--green)", fontWeight: 700 }}>{fmtBRL(totalRet)}</td>
            <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--red)", fontWeight: 700 }}>{fmtBRL(sum((a) => a.custoProduto))}</td>
            <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--red)", fontWeight: 700 }}>{fmtBRL(sum((a) => a.envioFull))}</td>
            <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--red)", fontWeight: 700 }}>{fmtBRL(sum((a) => a.taxaML))}</td>
            <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--red)", fontWeight: 700 }}>{fmtBRL(sum((a) => a.imposto))}</td>
            <td style={{ textAlign: "right", padding: "8px 10px", color: "var(--red)", fontWeight: 700 }}>{fmtBRL(sum((a) => a.ads))}</td>
            <td style={{ textAlign: "right", padding: "8px 10px", fontWeight: 700, color: totalBruto >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(totalBruto)}</td>
            <td style={{ textAlign: "right", padding: "8px 10px", fontWeight: 800, color: totalLucro >= 0 ? "var(--green)" : "var(--red)" }}>{fmtBRL(totalLucro)}</td>
            <td style={{ textAlign: "right", padding: "8px 10px" }}>
              <span style={{ fontWeight: 700, color: margemTotal >= 20 ? "var(--green)" : margemTotal >= 10 ? "#f7c948" : "var(--red)" }}>
                {margemTotal.toFixed(1)}%
              </span>
            </td>
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
  const [periodoMode, setPeriodoMode]   = useState<PeriodoMode>("mes");
  const [customFrom,  setCustomFrom]    = useState("");
  const [customTo,    setCustomTo]      = useState("");
  const [mlRefreshing, setMlRefreshing] = useState(false);
  const [mlLoading,    setMlLoading]    = useState(false);
  const [mlMetrics,    setMlMetrics]    = useState<MlMetrics | null>(null);
  const [mlAccount,    setMlAccount]    = useState<{ user?: { nickname?: string; site_id?: string } } | null>(null);
  const mountedRef = useRef(true);

  const periodoRange = useMemo((): { from: string; to: string } => {
    const today = todayISO();
    if (periodoMode === "hoje")   return { from: today, to: today };
    if (periodoMode === "ontem")  return { from: daysAgoISO(1), to: daysAgoISO(1) };
    if (periodoMode === "3d")     return { from: daysAgoISO(2), to: today };
    if (periodoMode === "7d")     return { from: daysAgoISO(6), to: today };
    if (periodoMode === "semana") return weekRange();
    if (periodoMode === "mes")    return monthRange(mes);
    if (customFrom && customTo)   return { from: customFrom, to: customTo };
    return monthRange(mes);
  }, [periodoMode, customFrom, customTo, mes]);

  const fetchMetrics = useCallback(async (from: string, to: string) => {
    setMlLoading(true);
    try {
      const res  = await authedFetch(`/api/ml/metrics?from=${from}&to=${to}`, { cache: "no-store" });
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
      .then((r) => r.ok ? r.json() : null)
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
        metaDiaria:  activeGoalEntry.metaDiaria ?? null,
        meta2Diaria: activeGoalEntry.meta2Diaria ?? null,
        meta3Diaria: activeGoalEntry.meta3Diaria ?? null,
        label:       activeGoalEntry.label,
      }
    : data.goals;

  // faturamento bruto (base das metas) e retorno líquido
  const fatBruto = mlMetrics?.faturamentoBruto ?? 0;
  const retorno  = mlMetrics?.totalRetorno ?? 0;

  // projeção baseada no faturamento bruto
  const projecao = useMemo(() => {
    if (periodoMode !== "mes" || !mlMetrics) return 0;
    const diaAtual  = diaAtualNoMes();
    const totalDias = diasNoMes(mes);
    if (diaAtual <= 0) return 0;
    return (fatBruto / diaAtual) * totalDias;
  }, [periodoMode, mlMetrics, fatBruto, mes]);

  const metaDiariaAtiva = goals?.metaDiaria ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ padding: "6px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
            <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>Conta ML: </span>
            <span style={{ fontWeight: 700 }}>{mlAccount?.user?.nickname ?? "—"}</span>
          </div>
          <button type="button" className="btn btn-sm btn-ghost"
            onClick={handleRefreshML} disabled={mlRefreshing}
            style={{ opacity: mlRefreshing ? 0.6 : 1 }}
          >
            {mlRefreshing ? "⏳ Sincronizando..." : "⟳ Atualizar ML"}
          </button>
        </div>

        {/* Filtro de período */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {(["hoje", "ontem", "3d", "7d", "semana", "mes", "custom"] as PeriodoMode[]).map((mode) => {
            const labels: Record<PeriodoMode, string> = {
              hoje: "📅 Hoje", ontem: "📅 Ontem", "3d": "3 dias", "7d": "7 dias",
              semana: "📆 Semana", mes: "🗓 Mês", custom: "🔎 Personalizado",
            };
            return (
              <button key={mode} type="button"
                className={`btn btn-sm ${periodoMode === mode ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setPeriodoMode(mode)}
              >
                {labels[mode]}
              </button>
            );
          })}
          {periodoMode === "custom" && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--fg)", padding: "4px 8px", fontSize: ".82rem" }}
              />
              <span style={{ color: "var(--muted)" }}>até</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--fg)", padding: "4px 8px", fontSize: ".82rem" }}
              />
            </>
          )}
          {mlMetrics && (
            <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>
              {mlMetrics.from} → {mlMetrics.to}
            </span>
          )}
        </div>
      </div>

      {/* ── Conteúdo ── */}
      {mlLoading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>⏳ Carregando dados…</div>
      ) : (
        <>
          {/* ── KPIs principais ── */}
          <div>
            <div style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", fontWeight: 700, marginBottom: 10 }}>
              💰 Resultado do Período
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <KpiCard label="Faturamento Bruto ML"        value={fatBruto}                             isCurrency colorOverride="positive" />
              <KpiCard label="Retorno sobre Vendas"        value={retorno}                              isCurrency colorOverride="neutral" />
              <KpiCard label="Faturamento Hoje"            value={mlMetrics?.faturamentoHoje ?? 0}      isCurrency colorOverride="positive" />
              <KpiCard label="Pedidos Hoje"                value={mlMetrics?.pedidosHoje ?? 0}          isCurrency={false} colorOverride="neutral" />
              <KpiCard label="Devoluções"                  value={mlMetrics?.devolucoes ?? 0}           isCurrency colorOverride="negative" />
              <KpiCard label="Lucro Líq. (sem custos op.)" value={mlMetrics?.lucroSemCustos ?? 0}       isCurrency colorOverride={(mlMetrics?.lucroSemCustos ?? 0) >= 0 ? "positive" : "negative"} />
              <KpiCard label="Lucro Líq. (com custos op.)" value={mlMetrics?.lucroComCustos ?? 0}       isCurrency colorOverride={(mlMetrics?.lucroComCustos ?? 0) >= 0 ? "positive" : "negative"} />
              <KpiCard label="Margem (sem custos op.)"     value={mlMetrics?.margemSemCustos ?? 0}      isPercent  colorOverride="margin" percentValue={mlMetrics?.margemSemCustos ?? 0} />
              <KpiCard label="Margem (com custos op.)"     value={mlMetrics?.margemComCustos ?? 0}      isPercent  colorOverride="margin" percentValue={mlMetrics?.margemComCustos ?? 0} />
            </div>
          </div>

          {/* ── Meta Diária + Composição de custos + Pedidos ── */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <MetaDiariaCard
              faturamentoHoje={mlMetrics?.faturamentoHoje ?? 0}
              pedidosHoje={mlMetrics?.pedidosHoje ?? 0}
              metaDiaria={metaDiariaAtiva}
            />

            {/* Custos */}
            <div style={{ flex: 1, minWidth: 240, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: ".7rem", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>
                📊 Composição de Custos
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { label: "CMV (custo do produto)", value: mlMetrics?.totalCMV ?? 0 },
                  { label: "Envio Full",             value: mlMetrics?.totalEnvio ?? 0 },
                  { label: "Taxas ML (comissão)",     value: mlMetrics?.totalTaxasML ?? 0 },
                  { label: "Imposto sobre venda",     value: mlMetrics?.totalImposto ?? 0 },
                  { label: "ADS (automático)",        value: mlMetrics?.totalAds ?? 0 },
                  { label: "Custos Operacionais",     value: mlMetrics?.custosOperacionais ?? 0 },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: ".84rem" }}>
                    <span style={{ color: "var(--muted)" }}>{label}</span>
                    <span style={{ color: "var(--red)", fontWeight: 700 }}>{fmtBRL(value)}</span>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: ".84rem" }}>
                  <span style={{ fontWeight: 700 }}>Total de Custos</span>
                  <span style={{ color: "var(--red)", fontWeight: 800 }}>
                    {fmtBRL(
                      (mlMetrics?.totalCMV ?? 0) +
                      (mlMetrics?.totalEnvio ?? 0) +
                      (mlMetrics?.totalTaxasML ?? 0) +
                      (mlMetrics?.totalImposto ?? 0) +
                      (mlMetrics?.totalAds ?? 0) +
                      (mlMetrics?.custosOperacionais ?? 0)
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Pedidos */}
            <div style={{ flex: 1, minWidth: 240, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: ".7rem", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>
                📦 Pedidos
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { label: "Pedidos no período",    value: String(mlMetrics?.ordersCount ?? 0) },
                  { label: "Sem produto vinculado", value: String(mlMetrics?.pedidosSemVinculo ?? 0) },
                  { label: "Ticket médio",          value: (mlMetrics?.ordersCount ?? 0) > 0 ? fmtBRL(fatBruto / mlMetrics!.ordersCount) : "—" },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: ".84rem" }}>
                    <span style={{ color: "var(--muted)" }}>{label}</span>
                    <span style={{ fontWeight: 700 }}>{value}</span>
                  </div>
                ))}
                {(mlMetrics?.pedidosSemVinculo ?? 0) > 0 && (
                  <div style={{
                    marginTop: 4, padding: "6px 10px",
                    background: "rgba(247,201,72,.1)", border: "1px solid rgba(247,201,72,.3)",
                    borderRadius: 6, fontSize: ".73rem", color: "#f7c948",
                  }}>
                    ⚠️ {mlMetrics?.pedidosSemVinculo} pedido(s) sem produto vinculado — corrija os SKUs no Estoque
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Tabela lucro por anúncio ── */}
          <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "18px 20px" }}>
            <div style={{ fontSize: ".78rem", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>
              📢 Lucro por Anúncio — Retorno − CMV − ADS
            </div>
            <div style={{ fontSize: ".75rem", color: "var(--muted)", marginBottom: 14 }}>
              Retorno = valor recebido por venda · CMV = custo do produto · ADS = gasto em publicidade no período
            </div>
            <TabelaAnuncios anuncios={mlMetrics?.anuncios ?? []} />
          </section>

          {/* ── Metas (só modo mês) ── */}
          {periodoMode === "mes" && (
            <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "18px 20px" }}>
              <div style={{
                fontSize: ".78rem", textTransform: "uppercase", letterSpacing: ".06em",
                color: "var(--muted)", fontWeight: 700, marginBottom: 16,
                display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8,
              }}>
                <span>🎯 Metas — {formatMesBR(mes)}</span>
                <span style={{ fontWeight: 400, fontSize: ".72rem" }}>Projeção: {fmtBRL(projecao)}</span>
              </div>

              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                <KpiCard label="Faturamento do Mês" value={fatBruto}  isCurrency colorOverride="positive" />
                <KpiCard label="Projeção"           value={projecao}  isCurrency colorOverride="neutral" />
                <KpiCard label="Margem do Mês"      value={mlMetrics?.margemComCustos ?? 0} isPercent colorOverride="margin" percentValue={mlMetrics?.margemComCustos ?? 0} />
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
                <div style={{ color: "var(--muted)", fontSize: ".82rem" }}>
                  Nenhuma meta configurada. Configure na aba Metas.
                </div>
              )}

              <div style={{ marginTop: 20 }}>
                <GoalsProgressBars
                  goals={goals}
                  days={[]}
                  liveRevenue={fatBruto}
                />
              </div>
            </section>
          )}

          {/* ── Gráfico (modo mês) ── */}
          {periodoMode === "mes" && (
            <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "18px 20px" }}>
              <div style={{ fontSize: ".78rem", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", fontWeight: 700, marginBottom: 14 }}>
                📈 Evolução do Faturamento
              </div>
              <RevenueLineChart days={[]} windowDays={30} />
            </section>
          )}

          {/* ── Doughnut ── */}
          <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "18px 20px", maxWidth: 480 }}>
            <div style={{ fontSize: ".78rem", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", fontWeight: 700, marginBottom: 14 }}>
              🥧 Composição dos Gastos
            </div>
            <ExpensesDoughnut
              produto={mlMetrics?.totalCMV ?? 0}
              envio={mlMetrics?.totalEnvio ?? 0}
              taxasML={mlMetrics?.totalTaxasML ?? 0}
              imposto={mlMetrics?.totalImposto ?? 0}
              ads={mlMetrics?.totalAds ?? 0}
              operacional={mlMetrics?.custosOperacionais ?? 0}
            />
          </section>
        </>
      )}
    </div>
  );
}
