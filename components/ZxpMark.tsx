"use client";

/**
 * Logomark: quadrado amarelo ML (#FFE600) + "Z" grafite geométrico, com um
 * ponto azul (#3483FA) de assinatura no canto — a mesma leitura de "dados,
 * crescimento, integração com o Mercado Livre" pedida na identidade, sem
 * reproduzir nenhum elemento gráfico do ML em si (só a cor institucional).
 * Fundo amarelo (não grafite) de propósito: a sidebar já é grafite, um
 * ícone grafite sobre fundo grafite desapareceria.
 * Mesmo desenho usado no favicon (app/icon.tsx), no ícone do iOS
 * (app/apple-icon.tsx) e nos ícones do PWA (app/manifest-icon-*).
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
      <rect width="100" height="100" rx={radius} fill="#FFE600" />
      <polygon
        points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34"
        fill="#0F1115"
      />
      <circle cx="74" cy="74" r="6" fill="#3483FA" />
    </svg>
  );
}
