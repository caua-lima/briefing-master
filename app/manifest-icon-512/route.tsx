import { ImageResponse } from "next/og";

export const dynamic = "force-static";

// Ícone 512×512 pro manifest do PWA — mesmo "Z" gradiente usado em
// app/icon.tsx e app/apple-icon.tsx, num tamanho maior (splash screen e
// ícones de alta densidade no Android).
export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "linear-gradient(135deg,#4f8ef7,#a78bfa)",
        }}
      >
        <svg width="512" height="512" viewBox="0 0 100 100">
          <polygon
            points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34"
            fill="#fff"
          />
        </svg>
      </div>
    ),
    { width: 512, height: 512 },
  );
}
