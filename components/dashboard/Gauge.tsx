"use client";

import { useId } from "react";
import { clamp } from "@/lib/domain/calc";

/** Velocímetro reutilizável (arco com gradiente + ponteiro + valor abaixo). */
export default function Gauge({
  pct, centerText, caption, leftLabel, rightLabel, footer,
}: {
  pct: number;
  centerText: string;
  caption: string;
  leftLabel?: string;
  rightLabel?: string;
  footer?: React.ReactNode;
}) {
  const p = clamp(pct, 0, 100);
  const zone = p >= 70 ? "#22c55e" : p >= 40 ? "#f59e0b" : "#ef4444";
  const angle = 180 - (p / 100) * 180;
  const rad = (angle * Math.PI) / 180;
  const nx = 100 + 58 * Math.cos(rad);
  const ny = 100 - 58 * Math.sin(rad);
  const gid = useId().replace(/:/g, "");

  const ticks = [0, 25, 50, 75, 100].map((t) => {
    const a = ((180 - (t / 100) * 180) * Math.PI) / 180;
    return {
      x1: 100 + 90 * Math.cos(a), y1: 100 - 90 * Math.sin(a),
      x2: 100 + 84 * Math.cos(a), y2: 100 - 84 * Math.sin(a),
    };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 300 }}>
      <div style={{ fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".07em", color: "var(--muted)", fontWeight: 800, marginBottom: 6, textAlign: "center" }}>
        {caption}
      </div>
      <svg viewBox="0 0 200 146" style={{ width: "100%" }}>
        <defs>
          <linearGradient id={`grad-${gid}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        {/* trilha + arco colorido */}
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--surface2)" strokeWidth="16" strokeLinecap="round" />
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke={`url(#grad-${gid})`} strokeWidth="16" strokeLinecap="round" />
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1.toFixed(1)} y1={t.y1.toFixed(1)} x2={t.x2.toFixed(1)} y2={t.y2.toFixed(1)} stroke="rgba(148,163,184,.45)" strokeWidth="1.5" />
        ))}
        {/* ponteiro */}
        <line x1="100" y1="100" x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke="var(--text)" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="100" cy="100" r="8" fill="var(--surface)" stroke="var(--text)" strokeWidth="2.5" />
        <circle cx="100" cy="100" r="3" fill={zone} />
        {/* rótulos das pontas (na linha do eixo) */}
        <text x="14" y="99" textAnchor="start" fontSize="9" fill="var(--muted)">{leftLabel}</text>
        <text x="186" y="99" textAnchor="end" fontSize="9" fill="var(--muted)">{rightLabel}</text>
        {/* valor: abaixo do eixo, em área livre (não cruza o ponteiro) */}
        <text x="100" y="138" textAnchor="middle" fontSize="30" fontWeight="800" fill={zone}>{centerText}</text>
      </svg>
      {footer && <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: 4, textAlign: "center" }}>{footer}</div>}
    </div>
  );
}
