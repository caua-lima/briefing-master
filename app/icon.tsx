import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Favicon: versão SIMPLIFICADA da marca — "Z" branco sobre violeta, sem o
// corte aqua. Em 16-32px o corte vira ruído e come a legibilidade do Z, então
// aqui vale só o contraste máximo. A versão completa (Z violeta sobre
// midnight + corte aqua) fica em components/ZxpMark.tsx e nos ícones grandes.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#8B5CF6",
          borderRadius: 7,
        }}
      >
        <svg width="32" height="32" viewBox="0 0 100 100">
          <polygon
            points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34"
            fill="#F3F6FF"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
