"use client";

/**
 * Logomark Zênite: "Z" violeta elétrico sobre fundo midnight, com um corte
 * aqua na diagonal — a diagonal do Z lida de baixo-esquerda para
 * cima-direita é a linha ascendente (crescimento/performance), e o corte
 * aqua reforça esse movimento sem virar "mais uma logo de marketplace".
 *
 * O corte só aparece a partir de ~24px: em tamanho de favicon ele vira ruído
 * e prejudica a leitura do Z, então some (ver `size` abaixo e app/icon.tsx,
 * que usa a versão simplificada).
 */
export function ZxpMark({ size = 30, radius = 24 }: { size?: number; radius?: number }) {
  const mostrarCorte = size >= 24;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ flexShrink: 0, display: "block" }}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="100" height="100" rx={radius} fill="#0B1020" />
      <polygon
        points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34"
        fill="#8B5CF6"
      />
      {mostrarCorte && (
        <line
          x1="35" y1="66" x2="65" y2="34"
          stroke="#22D3EE" strokeWidth="7" strokeLinecap="round"
        />
      )}
    </svg>
  );
}
