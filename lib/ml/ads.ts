import "server-only";
import { getValidMlAccessToken } from "@/lib/ml/getToken";

const ML_API = "https://api.mercadolibre.com";

/**
 * Retorna o gasto de ADS (Product Ads) agregado por item_id (MLB) no período.
 * Chave do mapa = item_id normalizado em UPPERCASE (ex.: "MLB1234567890").
 */
export async function getAdsSpendByItem(
  from: string,
  to: string,
): Promise<Record<string, number>> {
  const sellerId = process.env.ML_SELLER_ID;
  if (!sellerId) return {};

  const token = await getValidMlAccessToken();

  const res = await fetch(
    `${ML_API}/advertising/product_ads/metrics?` +
      `advertiser_id=${sellerId}&date_from=${from}&date_to=${to}` +
      `&group_by=ITEM_ID&fields=ITEM_ID,SPEND&limit=200`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );

  if (!res.ok) {
    throw new Error(`ml_ads_failed: ${await res.text()}`);
  }

  const json = await res.json();
  const rows = json?.data?.results ?? json?.results ?? [];
  const adsByItem: Record<string, number> = {};
  for (const row of rows) {
    const itemId = String(row.item_id ?? row.ITEM_ID ?? "").trim().toUpperCase();
    const spend = Number(row.spend ?? row.SPEND ?? 0);
    if (itemId) adsByItem[itemId] = (adsByItem[itemId] ?? 0) + spend;
  }
  return adsByItem;
}
