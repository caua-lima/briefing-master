"use client";

import { useMemo, useState } from "react";
import {
  computeSummary,
  fmtBRL,
  formatDateBR,
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

type Props = {
  data: UserData;
};

export default function Dashboard({ data }: Props) {
  const [chartWindow, setChartWindow] = useState<7 | 15 | 30>(15);
  const [dayMode, setDayMode] = useState<"hoje" | "ontem" | "custom">("hoje");
  const [customDate, setCustomDate] = useState("");

  const recomputedDays = useMemo(
    () => data.days.map((day) => ({ ...day, ...computeSummary(day.raw ?? []) })),
    [data.days]
  );

  const selectedDate =
    dayMode === "hoje"
      ? todayStr()
      : dayMode === "ontem"
        ? yesterdayStr()
        : customDate;

  const selectedArchivedDay =
    dayMode !== "hoje"
      ? (recomputedDays.find((d) => d.date === selectedDate) ?? null)
      : null;

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

  // Total revenue = faturamento from draft
  const faturamentoBruto = todaySummary.totalFaturamento;

  // Total gastos = CMV + Ads + custos do dia.
  const totalGastos =
    todaySummary.totalCMV + todaySummary.totalAds + custosDia;

  const margemLiquida =
    faturamentoBruto > 0 ? (lucroLiquidoFinal / faturamentoBruto) * 100 : 0;

  // Goals — use active entry or legacy
  const mes = mesAtual();
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

  // Doughnut nao mostra taxas ML separado pois retorno ja vem liquido.
  const taxasML = 0;

  const availableDates = [...data.days]
    .sort((a, b) => b.date.localeCompare(a.date));

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
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--fg)",
              padding: "4px 10px",
              fontSize: ".85rem",
              cursor: "pointer",
            }}
          >
            <option value="">Escolha um dia…</option>
            {availableDates.map((d) => (
              <option key={d.date} value={d.date}>
                {formatDateBR(d.date)}
              </option>
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

      {/* ── Row 1: 4 KPI Cards ── */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <KpiCard
          label="Faturamento Bruto"
          value={faturamentoBruto}
          isCurrency
          colorOverride="positive"
        />
        <KpiCard
          label="Gastos Totais"
          value={totalGastos}
          isCurrency
          colorOverride="negative"
        />
        <KpiCard
          label="Lucro Liquido Real"
          value={lucroLiquidoFinal}
          isCurrency
          colorOverride={lucroLiquidoFinal >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="Margem Liquida"
          value={margemLiquida}
          isPercent
          colorOverride="margin"
          percentValue={margemLiquida}
        />
      </div>

      {/* ── Row 2: Ontem vs Hoje ── */}
      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "18px 20px",
        }}
      >
        <div
          style={{
            fontSize: ".78rem",
            textTransform: "uppercase",
            letterSpacing: ".06em",
            color: "var(--muted)",
            marginBottom: 12,
            fontWeight: 700,
          }}
        >
          Ontem vs Hoje
        </div>
        <YesterdayVsToday days={recomputedDays} todayLiquido={lucroLiquidoFinal} />
      </section>

      {/* ── Row 3: Line Chart + Top 3 Ads ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)",
          gap: 16,
          alignItems: "start",
        }}
        className="dashboard-main-grid"
      >
        {/* Line Chart */}
        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "18px 20px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: ".78rem",
                textTransform: "uppercase",
                letterSpacing: ".06em",
                color: "var(--muted)",
                fontWeight: 700,
              }}
            >
              Faturamento & Lucro
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {([7, 15, 30] as const).map((w) => (
                <button
                  key={w}
                  type="button"
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

        {/* Top 3 Ads */}
        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "18px 20px",
          }}
        >
          <div
            style={{
              fontSize: ".78rem",
              textTransform: "uppercase",
              letterSpacing: ".06em",
              color: "var(--muted)",
              marginBottom: 12,
              fontWeight: 700,
            }}
          >
            Top 3 Anuncios (lucro hoje)
          </div>
          <TopAdsTable ads={todaySummary.ads} />

          {/* Custos breakdown */}
          {custosDia > 0 && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                background: "rgba(239,68,68,.07)",
                border: "1px solid rgba(239,68,68,.25)",
                borderRadius: 8,
                fontSize: ".78rem",
                color: "var(--red)",
              }}
            >
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

      {/* ── Row 4: Doughnut + Metas ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)",
          gap: 16,
          alignItems: "start",
        }}
        className="dashboard-bottom-grid"
      >
        {/* Expenses Doughnut */}
        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "18px 20px",
          }}
        >
          <div
            style={{
              fontSize: ".78rem",
              textTransform: "uppercase",
              letterSpacing: ".06em",
              color: "var(--muted)",
              marginBottom: 12,
              fontWeight: 700,
            }}
          >
            Composicao dos Gastos (hoje)
          </div>
          <ExpensesDoughnut
            produto={todaySummary.totalCMV}
            taxasML={Math.max(taxasML, 0)}
            ads={todaySummary.totalAds}
            operacional={custosDia}
          />
        </section>

        {/* Goals progress bars */}
        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "18px 20px",
          }}
        >
          <div
            style={{
              fontSize: ".78rem",
              textTransform: "uppercase",
              letterSpacing: ".06em",
              color: "var(--muted)",
              marginBottom: 14,
              fontWeight: 700,
            }}
          >
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
