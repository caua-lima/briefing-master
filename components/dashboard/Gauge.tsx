"use client";

import { useId } from "react";
import { clamp } from "@/lib/domain/calc";

/** Velocímetro reutilizável (arco com gradiente + ponteiro + %). */
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
  const zone = p >= 70 ? "var(--green)" : p >= 40 ? "var(--yellow)" : "var(--red)";
  const angle = 180 - (p / 100) * 180;
  const rad = (angle * Math.PI) / 180;
  const nx = 100 + 64 * Math.cos(rad);
  const ny = 100 - 64 * Math.sin(rad);
  const gid = useId().replace(/:/g, "");

  const ticks = [0, 25, 50, 75, 100].map((t) => {
    const a = ((180 - (t / 100) * 180) * Math.PI) / 180;
    return {
      x1: 100 + 90 * Math.cos(a), y1: 100 - 90 * Math.sin(a),
      x2: 100 + 82 * Math.cos(a), y2: 100 - 82 * Math.sin(a),
    };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 180 }}>
      <div style={{ fontSize: ".66rem", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)", fontWeight: 800, marginBottom: 2, textAlign: "center" }}>
        {caption}
      </div>
      <svg viewBox="0 0 200 126" style={{ width: "100%", maxWidth: 230 }}>
        <defs>
          <linearGradient id={`grad-${gid}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        {/* trilha de fundo */}
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--surface2)" strokeWidth="15" strokeLinecap="round" />
        {/* arco colorido */}
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke={`url(#grad-${gid})`} strokeWidth="15" strokeLinecap="round" />
        {/* ticks */}
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1.toFixed(1)} y1={t.y1.toFixed(1)} x2={t.x2.toFixed(1)} y2={t.y2.toFixed(1)} stroke="rgba(148,163,184,.4)" strokeWidth="1.5" />
        ))}
        {/* ponteiro */}
        <line x1="100" y1="100" x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke="var(--text)" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="100" cy="100" r="7" fill="var(--surface)" stroke="var(--text)" strokeWidth="2.5" />
        {/* valor central */}
        <text x="100" y="80" textAnchor="middle" fontSize="23" fontWeight="800" fill={zone}>{centerText}</text>
        {leftLabel && <text x="14" y="119" textAnchor="start" fontSize="8.5" fill="var(--muted)">{leftLabel}</text>}
        {rightLabel && <text x="186" y="119" textAnchor="end" fontSize="8.5" fill="var(--muted)">{rightLabel}</text>}
      </svg>
      {footer && <div style={{ fontSize: ".74rem", color: "var(--muted)", marginTop: 2, textAlign: "center" }}>{footer}</div>}
    </div>
  );
}
