"use client";

import { fmtBRL, clamp } from "@/lib/domain/calc";

function Card({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 150 }}>
      <div style={{ fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)", fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: "1.35rem", fontWeight: 800 }}>{value}</div>
      {sub && <div style={{ fontSize: ".72rem", marginTop: 4, color: subColor ?? "var(--muted)", fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

/** Painel de acompanhamento da meta com velocímetro (formato solicitado). */
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

  // ponteiro do velocímetro (semicírculo 180°→0°)
  const angle = 180 - (pct / 100) * 180;
  const rad = (angle * Math.PI) / 180;
  const nx = 100 + 70 * Math.cos(rad);
  const ny = 100 - 70 * Math.sin(rad);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, alignItems: "stretch" }}>
      <Card label="Faturamento" value={fmtBRL(fatBruto)} />
      <Card label={`Meta ${metaIndex}`} value={fmtBRL(activeMeta)} />

      {/* Velocímetro */}
      <div className="panel" style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 240 }}>
        <div style={{ fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)", fontWeight: 700, marginBottom: 4 }}>
          Progresso da Meta {metaIndex}
        </div>
        <svg viewBox="0 0 200 118" style={{ width: "100%", maxWidth: 260 }}>
          {/* trilha colorida */}
          <path d="M 20 100 A 80 80 0 0 1 60 30.72" fill="none" stroke="#ef4444" strokeWidth="14" strokeLinecap="round" />
          <path d="M 60 30.72 A 80 80 0 0 1 140 30.72" fill="none" stroke="#f59e0b" strokeWidth="14" />
          <path d="M 140 30.72 A 80 80 0 0 1 180 100" fill="none" stroke="#22c55e" strokeWidth="14" strokeLinecap="round" />
          {/* ponteiro */}
          <line x1="100" y1="100" x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke="var(--text)" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="100" cy="100" r="7" fill="var(--text)" />
          <text x="100" y="88" textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--text)">{pct.toFixed(0)}%</text>
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
