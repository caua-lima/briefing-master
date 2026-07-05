"use client";

import { fmtBRL, clamp } from "@/lib/domain/calc";

function compact(n: number): string {
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (n >= 1_000) return `R$ ${Math.round(n / 1_000)}k`;
  return fmtBRL(n);
}

function Card({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 150 }}>
      <div style={{ fontSize: ".66rem", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{value}</div>
      {sub && <div style={{ fontSize: ".72rem", marginTop: 4, color: subColor ?? "var(--muted)", fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

/** Painel de acompanhamento da meta com velocímetro. */
export default function MetasGauge({
  fatBruto, meta1, meta2, meta3, projecao, diaAtual, totalDias,
}: {
  fatBruto: number;
  meta1: number;
  meta2: number | null;
  meta3: number | null;
  projecao: number;
  diaAtual: number;
  totalDias: number;
}) {
  const metas = [meta1, meta2, meta3].filter((v): v is number => !!v && v > 0);
  // Meta ativa em cascata: só passa para a próxima após bater a anterior
  const activeMeta = metas.find((v) => fatBruto < v) ?? metas[metas.length - 1] ?? meta1;
  const metaIndex = Math.max(1, metas.indexOf(activeMeta) + 1);
  const pct = activeMeta > 0 ? clamp((fatBruto / activeMeta) * 100, 0, 100) : 0;
  const idealDia = activeMeta > 0 ? (activeMeta / totalDias) * diaAtual : 0;
  const deltaIdeal = fatBruto - idealDia;
  const noRitmo = projecao >= activeMeta;

  const zoneColor = pct >= 70 ? "var(--green)" : pct >= 40 ? "var(--yellow)" : "var(--red)";

  // ponteiro do velocímetro (semicírculo 180°→0°)
  const angle = 180 - (pct / 100) * 180;
  const rad = (angle * Math.PI) / 180;
  const nx = 100 + 68 * Math.cos(rad);
  const ny = 100 - 68 * Math.sin(rad);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, alignItems: "stretch" }}>
      <Card label="Faturamento" value={fmtBRL(fatBruto)} />
      <Card label={`Meta ${metaIndex}`} value={fmtBRL(activeMeta)} />

      {/* Velocímetro */}
      <div
        className="panel"
        style={{
          gridColumn: "span 2", minWidth: 260,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: `radial-gradient(600px 200px at 50% 120%, ${zoneColor === "var(--green)" ? "rgba(34,197,94,.10)" : zoneColor === "var(--yellow)" ? "rgba(245,158,11,.10)" : "rgba(239,68,68,.10)"}, transparent)`,
          border: `1px solid ${zoneColor}`,
        }}
      >
        <div style={{ fontSize: ".66rem", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", fontWeight: 700, marginBottom: 2 }}>
          Progresso da Meta {metaIndex}
        </div>
        <svg viewBox="0 0 200 128" style={{ width: "100%", maxWidth: 280 }}>
          <defs>
            <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
          {/* trilha de fundo */}
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--surface2)" strokeWidth="16" strokeLinecap="round" />
          {/* trilha colorida (gradiente) */}
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gaugeGrad)" strokeWidth="16" strokeLinecap="round" opacity="0.95" />
          {/* ponteiro */}
          <line x1="100" y1="100" x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke="var(--text)" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="100" cy="100" r="7" fill="var(--text)" />
          {/* % central */}
          <text x="100" y="84" textAnchor="middle" fontSize="24" fontWeight="800" fill={zoneColor}>{pct.toFixed(0)}%</text>
          {/* rótulos das pontas */}
          <text x="16" y="120" textAnchor="start" fontSize="9" fill="var(--muted)">R$ 0</text>
          <text x="184" y="120" textAnchor="end" fontSize="9" fill="var(--muted)">{compact(activeMeta)}</text>
        </svg>
      </div>

      <Card
        label="Ideal do dia"
        value={fmtBRL(idealDia)}
        sub={`${deltaIdeal >= 0 ? "+" : "−"}${fmtBRL(Math.abs(deltaIdeal))} vs ideal`}
        subColor={deltaIdeal >= 0 ? "var(--green)" : "var(--red)"}
      />
      <Card
        label="Projeção de fechamento"
        value={fmtBRL(projecao)}
        sub={noRitmo ? "✅ no ritmo da meta" : "⚠️ abaixo da meta"}
        subColor={noRitmo ? "var(--green)" : "var(--red)"}
      />
    </div>
  );
}
