"use client";

import { daysAgoStr, fmtBRL, yesterdayStr } from "@/lib/domain/calc";
import type { ArchivedDay } from "@/lib/domain/types";

type Props = {
  days: ArchivedDay[];
  todayLiquido: number;
};

export default function YesterdayVsToday({ days, todayLiquido }: Props) {
  const yDate = yesterdayStr();
  const windowStart = daysAgoStr(7);

  // Yesterday = strictly the archived day for yesterday's calendar date
  const yesterday = days.find((d) => d.date === yDate) ?? null;

  // Last 7 calendar days average (yesterday inclusive, today exclusive)
  const last7 = days.filter((d) => d.date >= windowStart && d.date <= yDate);
  const avg7 =
    last7.length > 0
      ? last7.reduce((s, d) => s + (d.totalLiquido ?? 0), 0) / last7.length
      : null;

  const yesterdayLiquido = yesterday?.totalLiquido ?? null;

  // % vs 7-day average
  let vsAvgPct: number | null = null;
  if (avg7 !== null && avg7 !== 0) {
    vsAvgPct = ((todayLiquido - avg7) / Math.abs(avg7)) * 100;
  }

  // % ontem vs media semana
  let ontemVsAvgPct: number | null = null;
  if (avg7 !== null && avg7 !== 0 && yesterdayLiquido !== null) {
    ontemVsAvgPct = ((yesterdayLiquido - avg7) / Math.abs(avg7)) * 100;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
      }}
    >
      {/* Ontem */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "16px 18px",
        }}
      >
        <div
          style={{
            fontSize: ".7rem",
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: ".06em",
            marginBottom: 6,
          }}
        >
          Lucro Ontem
        </div>
        <div
          style={{
            fontSize: "1.3rem",
            fontWeight: 700,
            color:
              yesterdayLiquido === null
                ? "var(--muted)"
                : yesterdayLiquido > 0
                ? "var(--green)"
                : "var(--red)",
          }}
        >
          {yesterdayLiquido === null ? "—" : fmtBRL(yesterdayLiquido)}
        </div>
        {ontemVsAvgPct !== null && (
          <div
            style={{
              fontSize: ".75rem",
              marginTop: 4,
              color: ontemVsAvgPct >= 0 ? "var(--green)" : "var(--red)",
            }}
          >
            {ontemVsAvgPct >= 0 ? "" : ""}{Math.abs(ontemVsAvgPct).toFixed(1)}% vs media 7d
          </div>
        )}
      </div>

      {/* Hoje (draft) */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "16px 18px",
        }}
      >
        <div
          style={{
            fontSize: ".7rem",
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: ".06em",
            marginBottom: 6,
          }}
        >
          Lucro Hoje (parcial)
        </div>
        <div
          style={{
            fontSize: "1.3rem",
            fontWeight: 700,
            color: todayLiquido > 0 ? "var(--green)" : todayLiquido < 0 ? "var(--red)" : "var(--muted)",
          }}
        >
          {todayLiquido === 0 ? "—" : fmtBRL(todayLiquido)}
        </div>
        {vsAvgPct !== null && todayLiquido !== 0 && (
          <div
            style={{
              fontSize: ".75rem",
              marginTop: 4,
              color: vsAvgPct >= 0 ? "var(--green)" : "var(--red)",
            }}
          >
            {vsAvgPct >= 0 ? "" : ""}{Math.abs(vsAvgPct).toFixed(1)}% vs media 7d
          </div>
        )}
      </div>

      {/* Media 7 dias */}
      {avg7 !== null && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "16px 18px",
          }}
        >
          <div
            style={{
              fontSize: ".7rem",
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: ".06em",
              marginBottom: 6,
            }}
          >
            Media 7d (Lucro)
          </div>
          <div
            style={{
              fontSize: "1.3rem",
              fontWeight: 700,
              color: avg7 > 0 ? "var(--green)" : "var(--red)",
            }}
          >
            {fmtBRL(avg7)}
          </div>
        </div>
      )}
    </div>
  );
}
