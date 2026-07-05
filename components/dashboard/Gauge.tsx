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
  const nx = 100 + 54 * Math.cos(rad);
  const ny = 100 - 54 * Math.sin(rad);
  const gid = useId().replace(/:/g, "");

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 260 }}>
      <div style={{ fontSize: ".66rem", textTransform: "uppercase", letterSpacing: ".07em", color: "var(--muted)", fontWeight: 800, marginBottom: 8, textAlign: "center" }}>
        {caption}
      </div>
      <svg viewBox="0 0 200 150" style={{ width: "100%" }}>
        <defs>
          <linearGradient id={`grad-${gid}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        {/* trilha + arco colorido */}
        <path d="M 22 100 A 78 78 0 0 1 178 100" fill="none" stroke="var(--surface2)" strokeWidth="13" strokeLinecap="round" />
        <path d="M 22 100 A 78 78 0 0 1 178 100" fill="none" stroke={`url(#grad-${gid})`} strokeWidth="13" strokeLinecap="round" />
        {/* ponteiro */}
        <line x1="100" y1="100" x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke="var(--text)" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="100" cy="100" r="7.5" fill="var(--surface)" stroke="var(--text)" strokeWidth="2.5" />
        <circle cx="100" cy="100" r="3" fill={zone} />
        {/* rótulos das pontas (abaixo do arco, sem sobrepor) */}
        <text x="8" y="122" textAnchor="start" fontSize="9.5" fill="var(--muted)">{leftLabel}</text>
        <text x="192" y="122" textAnchor="end" fontSize="9.5" fill="var(--muted)">{rightLabel}</text>
        {/* valor central, na área livre abaixo do eixo */}
        <text x="100" y="144" textAnchor="middle" fontSize="32" fontWeight="800" fill={zone}>{centerText}</text>
      </svg>
      {footer && <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: 4, textAlign: "center" }}>{footer}</div>}
    </div>
  );
}
