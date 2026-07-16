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
  if (id) advCache = { id, at: Date.now() }; // NÃO cacheia null (evita travar em 0)
  return id;
}

async function fetchJsonRetry(url: string, token: string, apiVersion: string, tries = 3): Promise<Response> {
  const opts: RequestInit = { headers: { Authorization: `Bearer ${token}`, "Api-Version": apiVersion }, cache: "no-store" };
  let res = await fetch(url, opts);
  // 429 (rate limit) / 5xx → espera curta e tenta de novo
  for (let i = 1; i < tries && (res.status === 429 || res.status >= 500); i++) {
    await new Promise((r) => setTimeout(r, 400 * i));
    res = await fetch(url, opts);
  }
  return res;
}

/**
 * Product Ads: o ML migrou esses recursos para a Api-Version 2 e descontinuou a
 * 1, que passou a responder 404. Usa a 2 e só cai pra 1 se a 2 não existir na
 * conta — assim funciona nos dois cenários sem depender de qual já migrou.
 */
async function fetchAds(url: string, token: string): Promise<Response> {
  const v2 = await fetchJsonRetry(url, token, "2");
  if (v2.status !== 404) return v2;
  const v1 = await fetchJsonRetry(url, token, "1", 1);
  return v1.ok ? v1 : v2;
}

/**
 * Gasto de ADS (Product Ads) por item_id (MLB) no período.
 * Chave do mapa = item_id em UPPERCASE (ex.: "MLB1234567890").
 *
 * Endpoint: /advertising/advertisers/{advertiser_id}/product_ads/items
 *   headers: Authorization + Api-Version: 2 (a 1 foi descontinuada → 404)
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

    const res = await fetchAds(url, token);
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

export type AdItemFull = {
  itemId: string;
  title: string;
  status: string;
  clicks: number;
  prints: number;      // impressões
  ctr: number;         // %
  cost: number;        // investimento R$
  cpc: number;         // custo por clique
  acos: number;        // % (custo / receita atribuída)
  cvr: number;         // % (conversão)
  sales: number;       // receita atribuída total (direto + indireto)
  units: number;       // unidades atribuídas
  directSales: number; // ⭐ receita das vendas DIRETAS do anúncio
  directUnits: number; // unidades diretas
  indirectSales: number;
};

const AD_METRICS = "clicks,prints,ctr,cost,cpc,acos,cvr,total_amount,direct_amount,indirect_amount,direct_items_quantity,advertising_items_quantity";

/** Métricas COMPLETAS de Product Ads por item no período (pra aba de análise). */
export async function getAdsFullByItem(from: string, to: string): Promise<AdItemFull[]> {
  const token = await getValidMlAccessToken();
  const advertiserId = await getAdvertiserId(token);
  if (!advertiserId) return [];

  const out: AdItemFull[] = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const url =
      `${ML_API}/advertising/advertisers/${advertiserId}/product_ads/items?` +
      `date_from=${from}&date_to=${to}&metrics=${AD_METRICS}&limit=${limit}&offset=${offset}`;
    const res = await fetchAds(url, token);
    if (!res.ok) throw new Error(`ml_ads_full_failed: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { results?: Record<string, unknown>[]; paging?: { total?: number } };
    const results = Array.isArray(j?.results) ? j.results : [];
    for (const row of results) {
      const m = (row.metrics as Record<string, unknown>) ?? row;
      const n = (k: string) => Number(m[k] ?? row[k] ?? 0) || 0;
      out.push({
        itemId: String(row.id ?? row.item_id ?? "").trim().toUpperCase(),
        title: String(row.title ?? row.name ?? ""),
        status: String(row.status ?? ""),
        clicks: n("clicks"),
        prints: n("prints"),
        ctr: n("ctr"),
        cost: n("cost"),
        cpc: n("cpc"),
        acos: n("acos"),
        cvr: n("cvr"),
        sales: n("total_amount"),
        units: n("advertising_items_quantity"),
        directSales: n("direct_amount"),
        directUnits: n("direct_items_quantity"),
        indirectSales: n("indirect_amount"),
      });
    }
    const total = j?.paging?.total ?? results.length;
    offset += results.length;
    if (offset >= total || results.length === 0) break;
  }
  return out;
}

/** Diagnóstico da API de ADS: mostra advertiser, status e amostra dos itens. */
export async function probeAds(from: string, to: string): Promise<Record<string, unknown>> {
  try {
    const token = await getValidMlAccessToken();
    const advRes = await fetch(`${ML_API}/advertising/advertisers?product_id=PADS`, {
      headers: { Authorization: `Bearer ${token}`, "Api-Version": "1" },
      cache: "no-store",
    });
    const advBody = await advRes.json().catch(() => null);
    const advertisers = (advBody as { advertisers?: Advertiser[] })?.advertisers ?? [];
    const mlb = advertisers.find((a) => String(a?.site_id ?? "").toUpperCase() === "MLB");
    const advertiserId = (mlb ?? advertisers[0])?.advertiser_id ?? null;

    // Testa as duas versões da API: o ML descontinuou a 1 (404) e migrou pra 2.
    let itemsStatusV2: number | null = null;
    let itemsStatusV1: number | null = null;
    let itemsStatus: number | null = null;
    let itemsSample: unknown = null;
    if (advertiserId != null) {
      const itemsUrl = `${ML_API}/advertising/advertisers/${advertiserId}/product_ads/items?date_from=${from}&date_to=${to}&metrics=cost&limit=3`;
      const r2 = await fetch(itemsUrl, { headers: { Authorization: `Bearer ${token}`, "Api-Version": "2" }, cache: "no-store" });
      itemsStatusV2 = r2.status;
      itemsSample = await r2.json().catch(() => null);
      const r1 = await fetch(itemsUrl, { headers: { Authorization: `Bearer ${token}`, "Api-Version": "1" }, cache: "no-store" });
      itemsStatusV1 = r1.status;
      if (r1.ok && !r2.ok) itemsSample = await r1.json().catch(() => null);
      itemsStatus = r2.ok ? r2.status : r1.status; // status efetivo
    }

    return {
      periodo: { from, to },
      advertisersStatus: advRes.status,
      advertisersCount: advertisers.length,
      advertiserId,
      itemsStatus,
      itemsStatusV2,
      itemsStatusV1,
      itemsSample,
    };
  } catch (e) {
    return { error: String(e) };
  }
}
