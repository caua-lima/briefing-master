import "server-only";
import { getValidMlAccessToken } from "@/lib/ml/getToken";

const ML_API = "https://api.mercadolibre.com";

type Advertiser = { advertiser_id?: number | string; site_id?: string; account_name?: string };

// Cache do advertiser_id por lambda quente (evita resolver a cada chamada)
let advCache: { id: string | null; at: number } | null = null;
const ADV_TTL = 10 * 60 * 1000;

/**
 * Resolve o advertiser_id da conta (NÃO é o seller_id). O ML exige buscar o
 * anunciante via /advertising/advertisers?product_id=PADS com header Api-Version.
 * Prioriza o anunciante do site MLB (Brasil).
 */
async function getAdvertiserId(token: string): Promise<string | null> {
  if (advCache && Date.now() - advCache.at < ADV_TTL) return advCache.id;

  const res = await fetch(`${ML_API}/advertising/advertisers?product_id=PADS`, {
    headers: { Authorization: `Bearer ${token}`, "Api-Version": "1" },
    cache: "no-store",
  });
  if (!res.ok) return advCache?.id ?? null; // mantém cache anterior em falha transitória
  const j = (await res.json()) as { advertisers?: Advertiser[] };
  const list = Array.isArray(j?.advertisers) ? j.advertisers : [];
  const mlb = list.find((a) => String(a.site_id ?? "").toUpperCase() === "MLB");
  const chosen = mlb ?? list[0];
  const id = chosen?.advertiser_id != null ? String(chosen.advertiser_id) : null;
  advCache = { id, at: Date.now() };
  return id;
}

/**
 * Gasto de ADS (Product Ads) por item_id (MLB) no período.
 * Chave do mapa = item_id em UPPERCASE (ex.: "MLB1234567890").
 *
 * Endpoint: /advertising/advertisers/{advertiser_id}/product_ads/items
 *   headers: Authorization + Api-Version: 1
 *   query:   date_from, date_to (YYYY-MM-DD, limite de 90 dias), metrics, limit, offset
 */
export async function getAdsSpendByItem(
  from: string,
  to: string,
): Promise<Record<string, number>> {
  const token = await getValidMlAccessToken();
  const advertiserId = await getAdvertiserId(token);
  if (!advertiserId) return {}; // conta sem anunciante/publicidade

  const adsByItem: Record<string, number> = {};
  let offset = 0;
  const limit = 50;

  while (true) {
    const url =
      `${ML_API}/advertising/advertisers/${advertiserId}/product_ads/items?` +
      `date_from=${from}&date_to=${to}&metrics=cost&limit=${limit}&offset=${offset}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Api-Version": "1" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`ml_ads_failed: ${await res.text()}`);

    const j = (await res.json()) as {
      results?: Record<string, unknown>[];
      paging?: { total?: number };
    };
    const results = Array.isArray(j?.results) ? j.results : [];

    for (const row of results) {
      const itemId = String(row.id ?? row.item_id ?? "").trim().toUpperCase();
      const metrics = (row.metrics as Record<string, unknown>) ?? {};
      const cost = Number(metrics.cost ?? row.cost ?? 0);
      if (itemId) adsByItem[itemId] = (adsByItem[itemId] ?? 0) + cost;
    }

    const total = j?.paging?.total ?? results.length;
    offset += results.length;
    if (offset >= total || results.length === 0) break;
  }

  return adsByItem;
}
