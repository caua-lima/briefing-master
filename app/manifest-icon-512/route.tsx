import { ImageResponse } from "next/og";

export const dynamic = "force-static";

// Ícone 512×512 pro manifest do PWA: fundo onyx #10100E, "Z" dourado
// #F4B942, sem gradiente — mesmo desenho de components/ZxpMark.tsx.
export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#10100E",
        }}
      >
        <svg width="512" height="512" viewBox="0 0 100 100">
          <polygon points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34" fill="#F4B942" />
        </svg>
      </div>
    ),
    { width: 512, height: 512 },
  );
}
