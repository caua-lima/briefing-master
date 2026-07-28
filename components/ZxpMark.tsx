"use client";

import { useId } from "react";

/**
 * Logomark da ZXP Solutions: quadrado arredondado em gradiente + "Z" geométrico.
 * O mesmo polígono é usado no favicon (app/icon.tsx, app/apple-icon.tsx e no
 * app/favicon.ico gerado), então o ícone da aba e o da sidebar são o mesmo desenho.
 */
export function ZxpMark({ size = 30, radius = 24 }: { size?: number; radius?: number }) {
  const gradId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ flexShrink: 0, display: "block" }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f8ef7" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx={radius} fill={`url(#${gradId})`} />
      <polygon
        points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34"
        fill="#fff"
      />
    </svg>
  );
}
