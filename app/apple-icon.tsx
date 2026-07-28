import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Ícone de tela inicial/bookmarks do iOS. Sem padding extra: o próprio iOS
// arredonda os cantos, então o quadrado vai até a borda (com leve raio para
// não ficar duro caso algum lugar não arredonde).
export default function AppleIcon() {
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
        <svg width="180" height="180" viewBox="0 0 100 100">
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
