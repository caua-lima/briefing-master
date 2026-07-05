"use client";

import { fmtBRL, clamp } from "@/lib/domain/calc";
import Gauge from "./Gauge";

function compact(n: number): string {
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (n >= 1_000) return `R$ ${Math.round(n / 1_000)}k`;
  return fmtBRL(n);
}

function Card({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 150 }}>
      <div style={{ fontSize: ".64rem", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: "1.35rem", fontWeight: 800 }}>{value}</div>
      {sub && <div style={{ fontSize: ".72rem", marginTop: 4, color: subColor ?? "var(--muted)", fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

/** Painel de acompanhamento das metas: velocímetros do mês e do lucro líquido. */
export default function MetasGauge({
  fatBruto, meta1, meta2, meta3, projecao, diaAtual, totalDias, margemAtual, metaMargem,
}: {
  fatBruto: number;
  meta1: number;
  meta2: number | null;
  meta3: number | null;
  projecao: number;
  diaAtual: number;
  totalDias: number;
  margemAtual: number;
  metaMargem: number;
}) {
  const metas = [meta1, meta2, meta3].filter((v): v is number => !!v && v > 0);
  const activeMeta = metas.find((v) => fatBruto < v) ?? metas[metas.length - 1] ?? meta1;
  const metaIndex = Math.max(1, metas.indexOf(activeMeta) + 1);
  const pctMes = activeMeta > 0 ? clamp((fatBruto / activeMeta) * 100, 0, 100) : 0;
  const idealDia = activeMeta > 0 ? (activeMeta / totalDias) * diaAtual : 0;
  const deltaIdeal = fatBruto - idealDia;
  const noRitmo = projecao >= activeMeta;
  const pctMargem = metaMargem > 0 ? clamp((margemAtual / metaMargem) * 100, 0, 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="panel" style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 28, padding: "22px 20px 16px" }}>
        <Gauge
          caption={`Meta do Mês ${metaIndex}`}
          pct={pctMes}
          centerText={`${pctMes.toFixed(0)}%`}
          leftLabel="R$ 0"
          rightLabel={compact(activeMeta)}
          footer={<><b style={{ color: "var(--text)" }}>{fmtBRL(fatBruto)}</b> de {compact(activeMeta)}</>}
        />
        <Gauge
          caption="Lucro Líquido (margem)"
          pct={pctMargem}
          centerText={`${margemAtual.toFixed(1)}%`}
          leftLabel="0%"
          rightLabel={`${metaMargem.toFixed(0)}%`}
          footer={<>meta de <b style={{ color: "var(--text)" }}>{metaMargem.toFixed(0)}%</b></>}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
        <Card label="Faturamento" value={fmtBRL(fatBruto)} />
        <Card label={`Meta ${metaIndex}`} value={fmtBRL(activeMeta)} />
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
    </div>
  );
}
