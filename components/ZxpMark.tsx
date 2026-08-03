"use client";

/**
 * Logomark Onyx Gold: "Z" dourado assinatura (#F4B942) sobre fundo onyx
 * (#10100E). Sem gradiente e sem detalhe fino de propósito — a marca tem que
 * ler igual em 16px (favicon) e em 512px (ícone de app), e qualquer corte
 * interno some no tamanho pequeno.
 *
 * O dourado é mais fechado que o amarelo do Mercado Livre justamente pra
 * NÃO parecer extensão visual do marketplace: aqui ele é cor de marca.
 */
export function ZxpMark({ size = 30, radius = 24 }: { size?: number; radius?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ flexShrink: 0, display: "block" }}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="100" height="100" rx={radius} fill="#10100E" />
      <polygon
        points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34"
        fill="#F4B942"
      />
    </svg>
  );
}
