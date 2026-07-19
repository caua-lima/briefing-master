import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken, getSellerId } from "@/lib/ml/tenant";

const ML_API = "https://api.mercadolibre.com";

/** Testa vários endpoints candidatos de inbound do Full e mostra qual responde. */
export async function GET(req: Request) {
  const gate = await requireAccess(req, { adminOnly: true });
  if (gate instanceof NextResponse) return gate;
  const SELLER_ID = await getSellerId(gate.uid);

  try {
    const token = await getMlAccessToken(gate.uid);
    if (!token) return NextResponse.json({ error: "sem token" }, { status: 400 });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Api-Version": "1" };

    const candidatos = [
      `/inbound/shipments/search?seller_id=${SELLER_ID}&limit=3`,
      `/inbound/shipments/search?seller_id=${SELLER_ID}&site_id=MLB&limit=3`,
      `/fbm/inbound/shipments/search?seller_id=${SELLER_ID}&limit=3`,
      `/stock/fulfillment/operations/search?seller_id=${SELLER_ID}&limit=3`,
      `/marketplace/stock/fulfillment/operations/search?seller_id=${SELLER_ID}&limit=3`,
      `/users/${SELLER_ID}/inbound/shipments`,
      `/inbound-shipments/search?seller_id=${SELLER_ID}&limit=3`,
      `/fulfillment/inbound_shipments/search?seller_id=${SELLER_ID}&limit=3`,
      `/logistics/inbound/shipments/search?seller_id=${SELLER_ID}&limit=3`,
    ];

    const resultados: { url: string; status: number; sample?: unknown }[] = [];
    for (const path of candidatos) {
      try {
        const res = await fetch(`${ML_API}${path}`, { headers, cache: "no-store" });
        const entry: { url: string; status: number; sample?: unknown } = { url: path, status: res.status };
        if (res.ok) entry.sample = await res.json().catch(() => null);
        else entry.sample = (await res.text().catch(() => "")).slice(0, 160);
        resultados.push(entry);
      } catch (e) {
        resultados.push({ url: path, status: -1, sample: String(e) });
      }
    }

    return NextResponse.json({ sellerId: SELLER_ID, resultados });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "debug_inbound_failed", details: msg }, { status: 500 });
  }
}
