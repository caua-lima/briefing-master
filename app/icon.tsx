import { ImageResponse } from "next/og";
import { comoDataUri, svgFavicon } from "@/lib/marca";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Favicon com a marca OFICIAL (ver lib/marca.ts). Variante invertida —
// fundo dourado, Z onyx — porque em 16-32px o Z vazado sobre fundo escuro
// perde peso na aba do navegador.
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={comoDataUri(svgFavicon())} alt="" width={32} height={32} />
      </div>
    ),
    { ...size },
  );
}
