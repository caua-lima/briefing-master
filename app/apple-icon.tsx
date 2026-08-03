import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Ícone de tela inicial/bookmarks do iOS: fundo grafite #0F1115, "Z" amarelo
// #FFE600, ponto azul #3483FA de assinatura no canto. Sem padding extra: o
// próprio iOS arredonda os cantos, então o quadrado vai até a borda (com
// leve raio para não ficar duro caso algum lugar não arredonde).
export default function AppleIcon() {
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
        <svg width="180" height="180" viewBox="0 0 100 100">
          <polygon
            points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34"
            fill="#FFE600"
          />
          <circle cx="74" cy="74" r="6" fill="#3483FA" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
