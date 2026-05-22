import { NextResponse } from "next/server";
import { getValidMlAccessToken } from "@/lib/ml/getToken";

export async function GET(req: Request) {
  try {
    const url  = new URL(req.url);
    const from = url.searchParams.get("from"); // YYYY-MM-DD
    const to   = url.searchParams.get("to");   // YYYY-MM-DD
    if (!from || !to) {
      return NextResponse.json({ error: "from e to são obrigatórios" }, { status: 400 });
    }

    const token      = await getValidMlAccessToken();
    const sellerId   = process.env.ML_SELLER_ID!;

    // Busca spend agregado por item_id no período
    const mlRes = await fetch(
      `https://api.mercadolibre.com/advertising/product_ads/metrics?` +
      `advertiser_id=${sellerId}&date_from=${from}&date_to=${to}` +
      `&group_by=ITEM_ID&fields=ITEM_ID,SPEND&limit=200`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );

    if (!mlRes.ok) {
      const err = await mlRes.text();
      return NextResponse.json({ error: "ml_ads_failed", details: err }, { status: mlRes.status });
    }

    const json = await mlRes.json();
    // Normaliza para Map: { "MLB1234": 45.20 }
    const adsByItem: Record<string, number> = {};
    const rows = json?.data?.results ?? json?.results ?? [];
    for (const row of rows) {
      const itemId = String(row.item_id ?? row.ITEM_ID ?? "").trim();
      const spend  = Number(row.spend ?? row.SPEND ?? 0);
      if (itemId) adsByItem[itemId] = (adsByItem[itemId] ?? 0) + spend;
    }

    return NextResponse.json({ adsByItem, from, to });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "ads_spend_failed", details: msg }, { status: 500 });
  }
}