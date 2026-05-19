"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import {
  computeSummary,
  diaAtualNoMes,
  diasNoMes,
  fmtBRL,
  formatDateBR,
  formatMesBR,
  mesAtual,
  todayStr,
  yesterdayStr,
  totalCustosDia,
  totalCustosMes,
} from "@/lib/domain/calc";
import type { UserData } from "@/components/useUserData";
import KpiCard from "./KpiCard";
import RevenueLineChart from "./RevenueLineChart";
import ExpensesDoughnut from "./ExpensesDoughnut";
import GoalsProgressBars from "./GoalsProgressBars";
import TopAdsTable from "./TopAdsTable";
import YesterdayVsToday from "./YesterdayVsToday";

type Props = { data: UserData };

// ── Gráfico de Metas em Cascata ────────────────────────────────
function MetasCascata({
  fatMes,
  projecao,
  meta1,
  meta2,
  meta3,
  label,
}: {
  fatMes: number;
  projecao: number;
  meta1: number;
  meta2: number | null;
  meta3: number | null;
  label?: string;
}) {
  const metas = [
    { valor: meta1, emoji: "🥇", nome: label || "Meta 1", cor: "#4f8ef7", corBg: "rgba(79,142,247,.13)" },
    ...(meta2 ? [{ valor: meta2, emoji: "🥈", nome: "Meta 2", cor: "#f7c948", corBg: "rgba(247,201,72,.13)" }] : []),
    ...(meta3 ? [{ valor: meta3, emoji: "🥉", nome: "Meta 3", cor: "#a855f7", corBg: "rgba(168,85,247,.13)" }] : []),
  ];

  // Gatilho: só mostra a próxima meta se a anterior foi batida
  const metasVisiveis: typeof metas = [];
  for (let i = 0; i < metas.length; i++) {
    metasVisiveis.push(metas[i]);
    if (fatMes < metas[i].valor) break; // para aqui se não bateu
  }

  const maxValor = metas[metas.length - 1].valor;
  const barraMax = Math.max(maxValor * 1.05, fatMes * 1.05, projecao * 1.05);

  const pctFat = Math.min((fatMes / barraMax) * 100, 100);
  const pctProj = Math.min((projecao / barraMax) * 100, 100);

  return (
    <div style={{ width: "100%" }}>
      {/* Labels das metas visíveis */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        {metasVisiveis.map((m, i) => {
          const batida = fatMes >= m.valor;
          const ativa = !batida && (i === 0 || fatMes >= metas[i - 1].valor);
          return (
            <div key={m.nome} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 12px",
              background: batida ? m.corBg : ativa ? m.corBg : "var(--surface2)",
              border: `1px solid ${batida || ativa ? m.cor : "var(--border)"}`,
              borderRadius: 999,
              fontSize: ".78rem",
              opacity: batida || ativa ? 1 : 0.5,
              transition: "all .3s",
            }}>
              <span>{m.emoji}</span>
              <span style={{ fontWeight: 700, color: batida || ativa ? m.cor : "var(--muted)" }}>{m.nome}</span>
              <span style={{ color: "var(--muted)" }}>{fmtBRL(m.valor)}</span>
              {batida && <span style={{ color: m.cor, fontWeight: 800 }}>✓</span>}
              {ativa && !batida && <span style={{ color: m.cor, fontSize: ".7rem" }}>← em curso</span>}
            </div>
          );
        })}
        {/* Próxima meta bloqueada */}
        {metasVisiveis.length < metas.length && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 12px",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            fontSize: ".78rem",
            opacity: 0.4,
          }}>
            <span>🔒</span>
            <span style={{ color: "var(--muted)" }}>{metas[metasVisiveis.length].nome} — desbloqueie batendo {metas[metasVisiveis.length - 1].nome}</span>
          </div>
        )}
      </div>

      {/* Barra principal */}
      <div style={{ position: "relative", height: 36, borderRadius: 999, background: "var(--surface2)", overflow: "visible" }}>

        {/* Marcadores das metas na barra */}
        {metasVisiveis.map((m) => {
          const pct = Math.min((m.valor / barraMax) * 100, 99.5);
          const batida = fatMes >= m.valor;
          return (
            <div key={m.valor} style={{
              position: "absolute", left: `${pct}%`, top: 0, bottom: 0,
              width: 2,
              background: m.cor,
              opacity: batida ? 1 : 0.5,
              zIndex: 3,
              borderRadius: 2,
            }}>
              <div style={{
                position: "absolute", bottom: "calc(100% + 4px)", left: "50%",
                transform: "translateX(-50%)",
                fontSize: ".65rem", color: m.cor, fontWeight: 700,
                whiteSpace: "nowrap", background: "var(--bg)", padding: "1px 4px",
                borderRadius: 4, border: `1px solid ${m.cor}`,
              }}>
                {m.emoji} {fmtBRL(m.valor)}
              </div>
            </div>
          );
        })}

        {/* Barra de projeção (fundo, tracejada) */}
        <div style={{
          position: "absolute", left: 0, top: "25%",
          height: "50%", width: `${pctProj}%`,
          background: "rgba(255,255,255,.06)",
          borderRadius: 999,
          border: "1px dashed rgba(255,255,255,.15)",
          zIndex: 1,
          transition: "width .5s ease",
        }} />

        {/* Barra de faturamento real */}
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${pctFat}%`,
          background: fatMes >= (meta3 ?? meta2 ?? meta1)
            ? "linear-gradient(90deg, #4f8ef7, #a855f7)"
            : fatMes >= (meta2 ?? meta1)
              ? "linear-gradient(90deg, #4f8ef7, #f7c948)"
              : "linear-gradient(90deg, #4f8ef7, #60a5fa)",
          borderRadius: 999,
          zIndex: 2,
          transition: "width .5s ease",
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          paddingRight: 10,
          minWidth: fatMes > 0 ? 60 : 0,
        }}>
          {fatMes > 0 && (
            <span style={{ fontSize: ".72rem", fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>
              {fmtBRL(fatMes)}
            </span>
          )}
        </div>
      </div>

      {/* Legenda inferior */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: ".7rem", color: "var(--muted)", marginTop: 8, flexWrap: "wrap", gap: 4,
      }}>
        <div style={{ display: "flex", gap: 14 }}>
          <span>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#4f8ef7", marginRight: 4, verticalAlign: "middle" }} />
            Faturamento atual
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

// ── Dashboard principal ────────────────────────────────────────
export default function Dashboard({ data }: Props) {
  const [chartWindow, setChartWindow] = useState<7 | 15 | 30>(15);
  const [dayMode, setDayMode] = useState<"hoje" | "ontem" | "custom">("hoje");
  const [customDate, setCustomDate] = useState("");

  const recomputedDays = useMemo(
    () => data.days.map((day) => ({ ...day, ...computeSummary(day.raw ?? []) })),
    [data.days]
  );

  const [mlToday, setMlToday] = useState<null | { faturamento: number; ordersCount: number; items: any[] }>(null);
  const [mlMetrics, setMlMetrics] = useState<null | { faturamento: number; ordersCount: number; start?: string; end?: string }>(null);
  const [mlMonthLoading, setMlMonthLoading] = useState(false);
  const mountedRef = useRef(true);

  const fetchMlToday = async () => {
    try {
      const res = await fetch('/api/ml/today', { cache: 'no-store' });
      if (!res.ok) {
        if (mountedRef.current) setMlToday(null);
        return;
      }
      const json = await res.json();
      if (mountedRef.current && json && json.connected) {
        setMlToday({ faturamento: Number(json.faturamento || 0), ordersCount: Number(json.ordersCount || 0), items: json.items || [] });
      } else if (mountedRef.current) {
        setMlToday(null);
      }
    } catch (e) {
      if (mountedRef.current) setMlToday(null);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    fetchMlToday();
    const id = setInterval(fetchMlToday, 60_000);
    return () => { mountedRef.current = false; clearInterval(id); };
  }, []);


  const fetchMlMonth = async (month?: string) => {
    setMlMonthLoading(true);
    try {
      const url = '/api/ml/metrics' + (month ? `?month=${month}` : `?month=${mes}`);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        setMlMetrics(null);
        return;
      }
      const json = await res.json();
      if (json && json.faturamento != null) {
        setMlMetrics({ faturamento: Number(json.faturamento || 0), ordersCount: Number(json.ordersCount || 0), start: json.start, end: json.end });
      } else {
        setMlMetrics(null);
      }
    } catch (e) {
      setMlMetrics(null);
    } finally {
      setMlMonthLoading(false);
    }
  };

  const selectedDate =
    dayMode === "hoje" ? todayStr() : dayMode === "ontem" ? yesterdayStr() : customDate;

  const selectedArchivedDay =
    dayMode !== "hoje" ? (recomputedDays.find((d) => d.date === selectedDate) ?? null) : null;

  const todaySummary = useMemo(() => {
    if (dayMode === "hoje") return computeSummary(data.draft?.ads ?? []);
    if (selectedArchivedDay) return computeSummary(selectedArchivedDay.raw ?? []);
    return computeSummary([]);
  }, [dayMode, data.draft, selectedArchivedDay]);

  const custosDia = useMemo(
    () => totalCustosDia(data.costs, selectedDate || todayStr()),
    [data.costs, selectedDate]
  );

  const custosMes = useMemo(
    () => totalCustosMes(data.costs, mesAtual()),
    [data.costs]
  );

  const lucroLiquidoFinal = todaySummary.totalLiquido - custosDia;
  const faturamentoBruto = todaySummary.totalFaturamento;
  const totalGastos = todaySummary.totalCMV + todaySummary.totalAds + custosDia;
  const margemLiquida = faturamentoBruto > 0 ? (lucroLiquidoFinal / faturamentoBruto) * 100 : 0;
  const taxasML = 0;

  const mes = mesAtual();
  useEffect(() => {
    fetchMlMonth(mes);
  }, [mes]);
  const activeGoalEntry = data.goalEntries.find((e) => e.mes === mes) ?? data.goalEntries[0] ?? null;
  const goals = activeGoalEntry
    ? {
        mes: activeGoalEntry.mes,
        meta1: activeGoalEntry.meta1,
        meta2: activeGoalEntry.meta2,
        meta3: activeGoalEntry.meta3,
        metaDiaria: activeGoalEntry.metaDiaria,
        meta2Diaria: activeGoalEntry.meta2Diaria,
        meta3Diaria: activeGoalEntry.meta3Diaria,
        label: activeGoalEntry.label,
      }
    : data.goals;

  const availableDates = [...data.days].sort((a, b) => b.date.localeCompare(a.date));

  // ── Resumo Mensal ──────────────────────────────────────────
  const mesResumo = useMemo(() => {
    const diasArquivados = recomputedDays.filter((d) => d.date.startsWith(mes));

    let fatMes = diasArquivados.reduce((s, d) => s + d.totalFaturamento, 0);
    let lucroMes = diasArquivados.reduce((s, d) => s + d.totalLiquido, 0);
    let cmvMes = diasArquivados.reduce((s, d) => s + d.totalCMV, 0);
    let adsMes = diasArquivados.reduce((s, d) => s + d.totalAds, 0);

    const draftDate = data.draft?.date ?? "";
    if (dayMode === "hoje" && draftDate.startsWith(mes)) {
      fatMes += todaySummary.totalFaturamento;
      lucroMes += todaySummary.totalLiquido;
      cmvMes += todaySummary.totalCMV;
      adsMes += todaySummary.totalAds;
    }

    const custosMesTotal = totalCustosMes(data.costs, mes);
    const lucroLiquidoMes = lucroMes - custosMesTotal;
    const margemMes = fatMes > 0 ? (lucroLiquidoMes / fatMes) * 100 : 0;

    const diaAtual = diaAtualNoMes();
    const totalDias = diasNoMes(mes);
    const mediaDiaria = diaAtual > 0 ? fatMes / diaAtual : 0;
    const projecao = mediaDiaria * totalDias;

    return { fatMes, lucroLiquidoMes, cmvMes, adsMes, custosMesTotal, margemMes, projecao, diaAtual, totalDias };
  }, [recomputedDays, data.draft, data.costs, dayMode, todaySummary, mes]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Day selector ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)", fontSize: ".82rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>
          Visualizar:
        </span>
        {(["hoje", "ontem", "custom"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`btn btn-sm ${dayMode === mode ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setDayMode(mode)}
          >
            {mode === "hoje" ? "📅 Hoje" : mode === "ontem" ? "⬅️ Ontem" : "🗓 Selecionar data"}
          </button>
        ))}
        {dayMode === "custom" && (
          <select
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", color: "var(--fg)",
              padding: "4px 10px", fontSize: ".85rem", cursor: "pointer",
            }}
          >
            <option value="">Escolha um dia…</option>
            {availableDates.map((d) => (
              <option key={d.date} value={d.date}>{formatDateBR(d.date)}</option>
            ))}
          </select>
        )}
        {dayMode === "custom" && customDate && !selectedArchivedDay && (
          <span style={{ color: "var(--red)", fontSize: ".8rem" }}>Nenhum dado para esta data.</span>
        )}
        {dayMode !== "hoje" && selectedArchivedDay && (
          <span style={{ color: "var(--muted)", fontSize: ".8rem" }}>
            Exibindo: {formatDateBR(selectedArchivedDay.date)}
          </span>
        )}
        {dayMode === "ontem" && !selectedArchivedDay && (
          <span style={{ color: "var(--red)", fontSize: ".8rem" }}>Ontem sem dados arquivados.</span>
        )}
      </div>

      {/* ── Resumo rápido de faturamento ── */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
          <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: 4 }}>Faturamento (dia)</div>
          <div style={{ fontWeight: 800, fontSize: ".98rem" }}>{fmtBRL(faturamentoBruto)}</div>
        </div>

        <div style={{ padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
          <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: 4 }}>Faturamento (mês)</div>
          <div style={{ fontWeight: 800, fontSize: ".98rem" }}>{fmtBRL(mesResumo.fatMes)}</div>
        </div>

        <div style={{ padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
          <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: 4 }}>ML hoje</div>
          <div style={{ fontWeight: 800, fontSize: ".98rem" }}>{mlToday ? fmtBRL(mlToday.faturamento) : "—"} {mlToday ? `(${mlToday.ordersCount} pedidos)` : ""}</div>
        </div>
      </div>

      {/* ── Row 1: KPI Cards do Dia ── */}
      <div>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 10,
        }}>
          <div style={{
            fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".06em",
            color: "var(--muted)", fontWeight: 700,
          }}>
            📅 Resultado do Dia
          </div>
          <div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => { setMlToday(null); fetchMlToday(); fetchMlMonth(mes); }}
            >
              ⟳ Atualizar ML agora
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <KpiCard label="Faturamento Bruto" value={faturamentoBruto} isCurrency colorOverride="positive" />
          <KpiCard label="Gastos Totais" value={totalGastos} isCurrency colorOverride="negative" />
          <KpiCard
            label="Lucro Líquido Real"
            value={lucroLiquidoFinal}
            isCurrency
            colorOverride={lucroLiquidoFinal >= 0 ? "positive" : "negative"}
          />
          <KpiCard
            label="Margem Líquida"
            value={margemLiquida}
            isPercent
            colorOverride="margin"
            percentValue={margemLiquida}
          />
          {mlToday && (
            <>
              <KpiCard label="ML: Faturamento Hoje" value={mlToday.faturamento} isCurrency colorOverride="positive" />
              <KpiCard label="ML: Pedidos Hoje" value={mlToday.ordersCount} isCurrency={false} colorOverride="neutral" />
            </>
          )}
        </div>
      </div>

      {/* ── Row 2: Resumo Mensal ── */}
      <section style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", padding: "18px 20px",
      }}>
        <div style={{
          fontSize: ".78rem", textTransform: "uppercase", letterSpacing: ".06em",
          color: "var(--muted)", fontWeight: 700, marginBottom: 16,
          display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8,
        }}>
          <span>📆 Resumo de {formatMesBR(mes)}</span>
          <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: ".72rem" }}>
            Dia {mesResumo.diaAtual} de {mesResumo.totalDias}
          </span>
        </div>

        {/* KPIs mensais */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
          <KpiCard
            label="Faturamento do Mês"
            value={mlMetrics ? mlMetrics.faturamento : mesResumo.fatMes}
            isCurrency
            colorOverride="positive"
          />
          <KpiCard
            label="Lucro Líquido do Mês"
            value={mesResumo.lucroLiquidoMes}
            isCurrency
            colorOverride={mesResumo.lucroLiquidoMes >= 0 ? "positive" : "negative"}
          />
          <KpiCard label="Custos Operacionais" value={mesResumo.custosMesTotal} isCurrency colorOverride="negative" />
          <KpiCard
            label="Margem do Mês"
            value={mesResumo.margemMes}
            isPercent
            colorOverride="margin"
            percentValue={mesResumo.margemMes}
          />
          <KpiCard label="Projeção de Fechamento" value={mesResumo.projecao} isCurrency colorOverride="neutral" />
        </div>

        {/* Gráfico de Metas em Cascata */}
        {goals?.meta1 ? (
          <div>
            <div style={{
              fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".06em",
              color: "var(--muted)", fontWeight: 700, marginBottom: 12,
            }}>
              🎯 Andamento das Metas
            </div>
            <MetasCascata
              fatMes={mesResumo.fatMes}
              projecao={mesResumo.projecao}
              meta1={goals.meta1}
              meta2={goals.meta2 ?? null}
              meta3={goals.meta3 ?? null}
              label={goals.label}
            />
          </div>
        ) : (
          <div style={{ color: "var(--muted)", fontSize: ".82rem", padding: "8px 0" }}>
            Nenhuma meta configurada para este mês.
          </div>
        )}
      </section>

      {/* ── Row 3: Ontem vs Hoje ── */}
      <section style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", padding: "18px 20px",
      }}>
        <div style={{
          fontSize: ".78rem", textTransform: "uppercase", letterSpacing: ".06em",
          color: "var(--muted)", marginBottom: 12, fontWeight: 700,
        }}>
          Ontem vs Hoje
        </div>
        <YesterdayVsToday days={recomputedDays} todayLiquido={lucroLiquidoFinal} />
      </section>

      {/* ── Row 4: Line Chart + Top 3 Ads ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)",
        gap: 16, alignItems: "start",
      }} className="dashboard-main-grid">
        <section style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", padding: "18px 20px",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 14, flexWrap: "wrap", gap: 8,
          }}>
            <div style={{
              fontSize: ".78rem", textTransform: "uppercase",
              letterSpacing: ".06em", color: "var(--muted)", fontWeight: 700,
            }}>
              Faturamento & Lucro
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {([7, 15, 30] as const).map((w) => (
                <button
                  key={w} type="button"
                  className={`btn btn-xs ${chartWindow === w ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setChartWindow(w)}
                >
                  {w}d
                </button>
              ))}
            </div>
          </div>
          <RevenueLineChart days={recomputedDays} windowDays={chartWindow} />
        </section>

        <section style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", padding: "18px 20px",
        }}>
          <div style={{
            fontSize: ".78rem", textTransform: "uppercase",
            letterSpacing: ".06em", color: "var(--muted)", marginBottom: 12, fontWeight: 700,
          }}>
            Top 3 Anuncios (lucro hoje)
          </div>
          <TopAdsTable ads={todaySummary.ads} />
          {custosDia > 0 && (
            <div style={{
              marginTop: 14, padding: "10px 12px",
              background: "rgba(239,68,68,.07)", border: "1px solid rgba(239,68,68,.25)",
              borderRadius: 8, fontSize: ".78rem", color: "var(--red)",
            }}>
              Custos operacionais hoje: <strong>{fmtBRL(custosDia)}</strong>
              {custosMes > 0 && (
                <span style={{ color: "var(--muted)", marginLeft: 8 }}>
                  | Mes: {fmtBRL(custosMes)}
                </span>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Row 5: Doughnut + Metas detalhadas ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)",
        gap: 16, alignItems: "start",
      }} className="dashboard-bottom-grid">
        <section style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", padding: "18px 20px",
        }}>
          <div style={{
            fontSize: ".78rem", textTransform: "uppercase",
            letterSpacing: ".06em", color: "var(--muted)", marginBottom: 12, fontWeight: 700,
          }}>
            Composição dos Gastos (hoje)
          </div>
          <ExpensesDoughnut
            produto={todaySummary.totalCMV}
            taxasML={Math.max(taxasML, 0)}
            ads={todaySummary.totalAds}
            operacional={custosDia}
          />
        </section>

        <section style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", padding: "18px 20px",
        }}>
          <div style={{
            fontSize: ".78rem", textTransform: "uppercase",
            letterSpacing: ".06em", color: "var(--muted)", marginBottom: 14, fontWeight: 700,
          }}>
            Progresso das Metas
          </div>
          <GoalsProgressBars
            goals={goals}
            days={recomputedDays}
            liveRevenue={faturamentoBruto}
          />
        </section>
      </div>
    </div>
  );
}