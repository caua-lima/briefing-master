import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Mesmo polígono do "Z" usado em components/ZxpMark.tsx e no favicon.ico
// gerado em scripts/gen-favicon.mjs — o ícone da aba, da sidebar e o
// favicon.ico legado precisam ser o mesmo desenho.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "linear-gradient(135deg,#4f8ef7,#a78bfa)",
          borderRadius: 7,
        }}
      >
        <svg width="32" height="32" viewBox="0 0 100 100">
          <polygon
            points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34"
            fill="#fff"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
