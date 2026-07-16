import "server-only";
import { getValidMlAccessToken } from "@/lib/ml/getToken";
import { SELLER_ID } from "@/lib/ml/orders";

const ML_API = "https://api.mercadolibre.com";

type Advertiser = { advertiser_id?: number | string; site_id?: string; account_name?: string };

type Adv = { id: string; siteId: string };

// Cache do anunciante por lambda quente (evita resolver a cada chamada)
let advCache: { adv: Adv | null; at: number } | null = null;
const ADV_TTL = 10 * 60 * 1000;

/**
 * Resolve o anunciante da conta (NÃO é o seller_id) e o site dele. O site entra
 * na URL dos recursos de Product Ads, por isso precisa vir junto.
 * Prioriza o anunciante do site MLB (Brasil).
 */
async function getAdvertiser(token: string): Promise<Adv | null> {
  if (advCache && Date.now() - advCache.at < ADV_TTL) return advCache.adv;

  const res = await fetch(`${ML_API}/advertising/advertisers?product_id=PADS`, {
    headers: { Authorization: `Bearer ${token}`, "Api-Version": "1" },
    cache: "no-store",
  });
  if (!res.ok) return advCache?.adv ?? null; // mantém cache anterior em falha transitória
  const j = (await res.json()) as { advertisers?: Advertiser[] };
  const list = Array.isArray(j?.advertisers) ? j.advertisers : [];
  const mlb = list.find((a) => String(a.site_id ?? "").toUpperCase() === "MLB");
  const chosen = mlb ?? list[0];
  if (chosen?.advertiser_id == null) return null;
  const adv: Adv = {
    id: String(chosen.advertiser_id),
    siteId: String(chosen.site_id ?? "MLB").toUpperCase(),
  };
  advCache = { adv, at: Date.now() }; // NÃO cacheia null (evita travar em 0)
  return adv;
}

/**
 * URLs do recurso de Product Ads. O ML moveu esses recursos para
 * /marketplace/advertising/{site}/advertisers/{id}/product_ads/{recurso}/search
 * e removeu o path antigo (/advertising/advertisers/{id}/product_ads/{recurso}),
 * que passou a responder 404. Mantém o antigo como fallback.
 */
function adsUrls(adv: Adv, recurso: "items" | "campaigns", query: string): string[] {
  return [
    `${ML_API}/marketplace/advertising/${adv.siteId}/advertisers/${adv.id}/product_ads/${recurso}/search?${query}`,
    `${ML_API}/advertising/advertisers/${adv.id}/product_ads/${recurso}?${query}`,
  ];
}

/** Tenta as URLs em ordem e devolve a 1ª que não for 404. */
async function fetchAdsResource(urls: string[], token: string): Promise<Response> {
  let ultima: Response | null = null;
  for (const url of urls) {
    const res = await fetchAds(url, token);
    if (res.status !== 404) return res;
    ultima = res;
  }
  return ultima as Response;
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
 * Uma página de itens. `campaignId` opcional: o ML passou a recusar (404) a
 * busca de itens sem escopo de campanha. Devolve null no 404 para o chamador
 * poder tentar a outra estratégia.
 */
async function itemsPage(
  adv: Adv, token: string, from: string, to: string,
  metrics: string, campaignId: string | null, offset: number,
): Promise<{ results: Record<string, unknown>[]; total: number } | null> {
  const filtro = campaignId ? `&filters[campaign_id]=${encodeURIComponent(campaignId)}` : "";
  const query = `date_from=${from}&date_to=${to}&metrics=${metrics}&limit=50&offset=${offset}${filtro}`;
  const res = await fetchAdsResource(adsUrls(adv, "items", query), token);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ml_ads_failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { results?: Record<string, unknown>[]; paging?: { total?: number } };
  const results = Array.isArray(j?.results) ? j.results : [];
  return { results, total: j?.paging?.total ?? results.length };
}

/** Todas as páginas de um escopo (geral ou de uma campanha). null = 404 logo de cara. */
async function itemsAll(
  adv: Adv, token: string, from: string, to: string,
  metrics: string, campaignId: string | null,
): Promise<Record<string, unknown>[] | null> {
  const out: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const page = await itemsPage(adv, token, from, to, metrics, campaignId, offset);
    if (page === null) return offset === 0 ? null : out;
    out.push(...page.results);
    offset += page.results.length;
    if (page.results.length === 0 || offset >= page.total) break;
  }
  return out;
}

/** IDs das campanhas de Product Ads do anunciante no período. */
async function campaignIds(adv: Adv, token: string, from: string, to: string): Promise<string[]> {
  const query = `date_from=${from}&date_to=${to}&metrics=cost&limit=100&offset=0`;
  const res = await fetchAdsResource(adsUrls(adv, "campaigns", query), token);
  if (!res.ok) return [];
  const j = (await res.json()) as { results?: Record<string, unknown>[] };
  return (j.results ?? [])
    .map((c) => String(c.id ?? c.campaign_id ?? ""))
    .filter(Boolean);
}

/**
 * Linhas de item com métricas. Tenta a busca direta e, se o ML recusar (404 —
 * ele passou a exigir o escopo de campanha), varre campanha a campanha usando
 * filters[campaign_id].
 */
async function adItemRows(from: string, to: string, metrics: string): Promise<Record<string, unknown>[]> {
  const token = await getValidMlAccessToken();
  const adv = await getAdvertiser(token);
  if (!adv) return []; // conta sem anunciante/publicidade

  const direto = await itemsAll(adv, token, from, to, metrics, null);
  if (direto !== null) return direto;

  const ids = await campaignIds(adv, token, from, to);
  if (ids.length === 0) throw new Error("ml_ads_404: itens recusados e nenhuma campanha retornada");

  const out: Record<string, unknown>[] = [];
  for (const cid of ids) {
    const rows = await itemsAll(adv, token, from, to, metrics, cid);
    if (rows) out.push(...rows);
  }
  return out;
}

/**
 * Gasto de ADS (Product Ads) por item_id (MLB) no período.
 * Chave do mapa = item_id em UPPERCASE (ex.: "MLB1234567890").
 */
export async function getAdsSpendByItem(
  from: string,
  to: string,
): Promise<Record<string, number>> {
  const adsByItem: Record<string, number> = {};
  for (const row of await adItemRows(from, to, "cost")) {
    const itemId = String(row.id ?? row.item_id ?? "").trim().toUpperCase();
    const metrics = (row.metrics as Record<string, unknown>) ?? {};
    const cost = Number(metrics.cost ?? row.cost ?? 0);
    if (itemId) adsByItem[itemId] = (adsByItem[itemId] ?? 0) + cost;
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
  return (await adItemRows(from, to, AD_METRICS)).map((row) => {
    const m = (row.metrics as Record<string, unknown>) ?? row;
    const n = (k: string) => Number(m[k] ?? row[k] ?? 0) || 0;
    return {
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
    };
  });
}

/** Diagnóstico da API de ADS: mostra advertiser, status e amostra dos itens. */
export async function probeAds(from: string, to: string): Promise<Record<string, unknown>> {
  try {
    const token = await getValidMlAccessToken();

    // De qual conta ML é esse token? Comparar com o seller_id usado nos pedidos
    // revela se Ads e Pedidos estão olhando para contas diferentes.
    const meRes = await fetch(`${ML_API}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const me = (await meRes.json().catch(() => null)) as
      | { id?: number; nickname?: string; site_id?: string }
      | null;
    const conta = {
      tokenUserId: me?.id ?? null,
      tokenNickname: me?.nickname ?? null,
      tokenSite: me?.site_id ?? null,
      sellerIdDosPedidos: SELLER_ID,
      mesmaConta: me?.id != null ? String(me.id) === String(SELLER_ID) : null,
    };

    const advRes = await fetch(`${ML_API}/advertising/advertisers?product_id=PADS`, {
      headers: { Authorization: `Bearer ${token}`, "Api-Version": "1" },
      cache: "no-store",
    });
    const advBody = await advRes.json().catch(() => null);
    const advertisers = (advBody as { advertisers?: Advertiser[] })?.advertisers ?? [];
    const mlb = advertisers.find((a) => String(a?.site_id ?? "").toUpperCase() === "MLB");
    const advertiserId = (mlb ?? advertisers[0])?.advertiser_id ?? null;

    // Sonda as variações do recurso e captura o CORPO como texto — o ML manda a
    // causa real ali (ex.: "No permissions found for user_id"), e ler como JSON
    // estava descartando essa mensagem.
    const H = (v: string) => ({ Authorization: `Bearer ${token}`, "Api-Version": v });
    const tentativas: Record<string, unknown>[] = [];
    let itemsStatusV2: number | null = null;
    let itemsStatusV1: number | null = null;

    if (advertiserId != null) {
      const site = String((mlb ?? advertisers[0])?.site_id ?? "MLB").toUpperCase();
      const novo = `${ML_API}/marketplace/advertising/${site}/advertisers/${advertiserId}/product_ads`;
      const antigo = `${ML_API}/advertising/advertisers/${advertiserId}/product_ads`;
      const q = `date_from=${from}&date_to=${to}&metrics=cost&limit=3`;
      const alvos: { nome: string; url: string; v: string }[] = [
        { nome: "NOVO items/search v2", url: `${novo}/items/search?${q}`, v: "2" },
        { nome: "NOVO campaigns/search v2", url: `${novo}/campaigns/search?${q}`, v: "2" },
        { nome: "NOVO items/search v1", url: `${novo}/items/search?${q}`, v: "1" },
        { nome: "antigo items v2", url: `${antigo}/items?${q}`, v: "2" },
        { nome: "antigo campaigns v2", url: `${antigo}/campaigns?${q}`, v: "2" },
      ];
      for (const a of alvos) {
        try {
          const r = await fetch(a.url, { headers: H(a.v), cache: "no-store" });
          const body = (await r.text().catch(() => "")).slice(0, 180);
          tentativas.push({ tentativa: a.nome, status: r.status, body });
          if (a.nome === "NOVO items/search v2") itemsStatusV2 = r.status;
          if (a.nome === "antigo items v2") itemsStatusV1 = r.status;
        } catch (e) {
          tentativas.push({ tentativa: a.nome, erro: String(e).slice(0, 120) });
        }
      }
    }

    return {
      periodo: { from, to },
      conta,
      advertisersStatus: advRes.status,
      advertisersCount: advertisers.length,
      advertisers, // lista crua: mostra todos os anunciantes que o token enxerga
      advertiserId,
      advertiserSite: (mlb ?? advertisers[0])?.site_id ?? null,
      itemsStatus: itemsStatusV2 ?? itemsStatusV1,
      itemsStatusV2,
      itemsStatusV1,
      tentativas,
    };
  } catch (e) {
    return { error: String(e) };
  }
}
