import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Ícone de tela inicial do iOS: fundo onyx #10100E, "Z" dourado #F4B942
// grande, sem gradiente. Sem padding extra — o próprio iOS arredonda.
export default function AppleIcon() {
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
        <svg width="180" height="180" viewBox="0 0 100 100">
          <polygon points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34" fill="#F4B942" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
