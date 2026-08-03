import { ImageResponse } from "next/og";

export const dynamic = "force-static";

// Ícone 192×192 pro manifest do PWA: fundo grafite #0F1115, "Z" amarelo
// #FFE600, ponto azul #3483FA de assinatura — mesmo desenho de
// components/ZxpMark.tsx e app/apple-icon.tsx, só num tamanho que o Android
// exige pra oferecer "Instalar app".
export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0F1115",
        }}
      >
        <svg width="192" height="192" viewBox="0 0 100 100">
          <polygon
            points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34"
            fill="#FFE600"
          />
          <circle cx="74" cy="74" r="6" fill="#3483FA" />
        </svg>
      </div>
    ),
    { width: 192, height: 192 },
  );
}
