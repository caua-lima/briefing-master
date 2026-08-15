import { ImageResponse } from "next/og";
import { comoDataUri, svgAppIcon } from "@/lib/marca";

export const dynamic = "force-static";

// Ícone 512×512 do PWA, com a marca oficial (ver lib/marca.ts).
export function GET() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={comoDataUri(svgAppIcon())} alt="" width={512} height={512} />
      </div>
    ),
    { width: 512, height: 512 },
  );
}
