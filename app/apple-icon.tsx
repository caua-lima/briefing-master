import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Ícone de tela inicial do iOS: marca completa — fundo midnight #0B1020,
// "Z" violeta #8B5CF6 e o corte aqua #22D3EE na diagonal ascendente. Sem
// padding extra: o próprio iOS arredonda os cantos.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0B1020",
        }}
      >
        <svg width="180" height="180" viewBox="0 0 100 100">
          <polygon
            points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34"
            fill="#8B5CF6"
          />
          <line x1="35" y1="66" x2="65" y2="34" stroke="#22D3EE" strokeWidth="7" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
