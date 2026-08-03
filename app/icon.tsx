import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Favicon: fundo amarelo institucional #FFE600, "Z" grafite #0F1115. Sem
// gradiente/detalhe fino de propósito — em 32px (e menor, quando o navegador
// reduz ainda mais) qualquer detalhe some, então fica só o essencial: alto
// contraste, forma simples. Mesmo polígono usado em components/ZxpMark.tsx,
// app/apple-icon.tsx e nos ícones do manifest do PWA.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#FFE600",
          borderRadius: 7,
        }}
      >
        <svg width="32" height="32" viewBox="0 0 100 100">
          <polygon
            points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34"
            fill="#0F1115"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
