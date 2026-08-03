import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Favicon: fundo dourado #F4B942 com "Z" onyx #10100E — invertido em relação
// à logo da sidebar de propósito. Em 16-32px o Z vazado num fundo escuro perde
// peso na aba do navegador; o bloco dourado cheio garante a leitura.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#F4B942",
          borderRadius: 7,
        }}
      >
        <svg width="32" height="32" viewBox="0 0 100 100">
          <polygon points="18,18 82,18 82,34 52,66 82,66 82,82 18,82 18,66 48,34 18,34" fill="#10100E" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
