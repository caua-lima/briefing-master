import "server-only";
import { getValidMlAccessToken } from "@/lib/ml/getToken";

const ML_API = "https://api.mercadolibre.com";

type Advertiser = { advertiser_id?: number | string; site_id?: string; account_name?: string };
type Adv = { id: string; siteId: string };

// Cache do anunciante POR USUÁRIO. Antes era uma variável só: num SaaS isso
// serviria o anunciante de um cliente para outro (dado de terceiro na tela).
const advCache = new Map<string, { adv: Adv | null; at: number }>();
const ADV_TTL = 10 * 60 * 1000;

/**
 * Resolve o anunciante da conta (NÃO é o seller_id) e o site dele.
 * O site entra na URL dos recursos de Product Ads, por isso vem junto.
 */
async function getAdvertiser(uid: string, token: string): Promise<Adv | null> {
  const cached = advCache.get(uid);
  if (cached && Date.now() - cached.at < ADV_TTL) return cached.adv;

  const res = await fetch(`${ML_API}/advertising/advertisers?product_id=PADS`, {
    headers: { Authorization: `Bearer ${token}`, "Api-Version": "1" },
    cache: "no-store",
  });
  if (!res.ok) return advCache.get(uid)?.adv ?? null; // mantém cache anterior em falha transitória
  const j = (await res.json()) as { advertisers?: Advertiser[] };
  const list = Array.isArray(j?.advertisers) ? j.advertisers : [];
  const chosen = list.find((a) => String(a.site_id ?? "").toUpperCase() === "MLB") ?? list[0];
  if (chosen?.advertiser_id == null) return null;
  const adv: Adv = { id: String(chosen.advertiser_id), siteId: String(chosen.site_id ?? "MLB").toUpperCase() };
  advCache.set(uid, { adv, at: Date.now() }); // NÃO cacheia null (evita travar em 0)
  return adv;
}

/** GET com retry em 429/5xx, tentando Api-Version 2 e caindo pra 1. */
async function get(url: string, token: string): Promise<Response> {
  const call = async (v: string) => {
    let res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Api-Version": v }, cache: "no-store" });
    for (let i = 1; i < 3 && (res.status === 429 || res.status >= 500); i++) {
      await new Promise((r) => setTimeout(r, 400 * i));
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Api-Version": v }, cache: "no-store" });
    }
    return res;
  };
  const v2 = await call("2");
  if (v2.status !== 404) return v2;
  const v1 = await call("1");
  return v1.status === 404 ? v2 : v1;
}

/**
 * Extrai as linhas da resposta sem depender de um nome de campo fixo. O ML mudou
 * o formato ao migrar o recurso; ler só `results` fazia a lista vir vazia e o
 * gasto virar R$ 0,00 silenciosamente.
 */
function extrairLinhas(j: unknown): Record<string, unknown>[] {
  if (!j || typeof j !== "object") return [];
  const o = j as Record<string, unknown>;
  for (const k of ["results", "items", "ads", "data", "campaigns"]) {
    if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  for (const v of Object.values(o)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") return v as Record<string, unknown>[];
  }
  return [];
}

/** Número de uma métrica, esteja ela em row.metrics.X, row.metrics_summary.X ou row.X. */
function metrica(row: Record<string, unknown>, chave: string): number {
  const fontes = [row.metrics, row.metrics_summary, row].filter(
    (f): f is Record<string, unknown> => !!f && typeof f === "object",
  );
  for (const f of fontes) {
    const v = f[chave];
    if (v != null && v !== "") return Number(v) || 0;
  }
  return 0;
}

const CHAVES_ID = ["item_id", "mlb_item_id", "item", "id"] as const;
const texto = (v: unknown) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";

/**
 * MLB do anúncio. Prioriza um valor no formato MLBxxxx: o cruzamento com as
 * vendas é por MLB, e pegar o id da campanha aqui zerava o modo "Geral".
 */
function itemIdDe(row: Record<string, unknown>): string {
  for (const k of CHAVES_ID) {
    const s = texto(row[k]);
    if (/^MLB\d+$/i.test(s)) return s.toUpperCase();
  }
  for (const k of CHAVES_ID) {
    const s = texto(row[k]);
    if (s) return s.toUpperCase();
  }
  return "";
}

const base = (adv: Adv) => `${ML_API}/marketplace/advertising/${adv.siteId}/advertisers/${adv.id}/product_ads`;
const legado = (adv: Adv) => `${ML_API}/advertising/advertisers/${adv.id}/product_ads`;

const ehMlb = (s: string) => /^MLB\d+$/i.test(s);

// Cache do mapa campanha → MLB, POR USUÁRIO (mesmo TTL do anunciante)
const mapaCache = new Map<string, { mapa: Record<string, string>; at: number }>();

/**
 * Mapa campaign_id → MLB, montado perguntando ao ML a qual campanha cada um dos
 * nossos anúncios pertence (/advertising/product_ads/items/{MLB} devolve
 * campaign_id). Serve para traduzir linhas de CAMPANHA em anúncio de verdade —
 * sem isso o cruzamento com as vendas (que é por MLB) não acha nada.
 */
async function mapaCampanhaMlb(uid: string, token: string, mlbs: string[]): Promise<Record<string, string>> {
  const cached = mapaCache.get(uid);
  if (cached && Date.now() - cached.at < ADV_TTL) return cached.mapa;
  const mapa: Record<string, string> = {};
  await Promise.all(
    mlbs.map(async (mlb) => {
      try {
        const r = await get(`${ML_API}/advertising/product_ads/items/${mlb}`, token);
        if (!r.ok) return;
        const j = (await r.json()) as Record<string, unknown>;
        const cid = texto(j.campaign_id);
        if (cid) mapa[cid] = mlb.toUpperCase();
      } catch { /* item fora de ads: ignora */ }
    }),
  );
  if (Object.keys(mapa).length > 0) mapaCache.set(uid, { mapa, at: Date.now() });
  return mapa;
}

/** Troca id de campanha pelo MLB do anúncio quando a linha não veio com MLB. */
async function resolverMlb(
  uid: string, rows: Record<string, unknown>[], token: string, mlbs: string[],
): Promise<Record<string, unknown>[]> {
  if (mlbs.length === 0 || rows.every((r) => ehMlb(itemIdDe(r)))) return rows;
  const mapa = await mapaCampanhaMlb(uid, token, mlbs);
  if (Object.keys(mapa).length === 0) return rows; // sem mapa: mantém como está
  return rows.map((r) => {
    const id = itemIdDe(r);
    if (ehMlb(id)) return r;
    const mlb = mapa[texto(r.campaign_id) || id];
    return mlb ? { ...r, item_id: mlb } : r;
  });
}

/** Busca paginada de um recurso, tentando as URLs candidatas em ordem. */
async function buscar(urls: (offset: number) => string[], token: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    let linhas: Record<string, unknown>[] | null = null;
    let total = 0;
    for (const url of urls(offset)) {
      const res = await get(url, token);
      if (res.status === 404) continue; // rota não existe → tenta a próxima
      if (!res.ok) throw new Error(`ml_ads_http_${res.status}: ${(await res.text()).slice(0, 160)}`);
      const j = await res.json().catch(() => null);
      linhas = extrairLinhas(j);
      total = Number((j as { paging?: { total?: number } })?.paging?.total ?? linhas.length);
      break;
    }
    if (linhas === null) return out; // nenhuma URL respondeu → deixa o chamador decidir
    out.push(...linhas);
    offset += linhas.length;
    if (linhas.length === 0 || offset >= total) break;
  }
  return out;
}

/** Linhas de item com métricas, tentando o recurso novo e, se preciso, por campanha. */
async function adItemRows(uid: string, from: string, to: string, metrics: string): Promise<Record<string, unknown>[]> {
  const token = await getValidMlAccessToken(uid);
  const adv = await getAdvertiser(uid, token);
  if (!adv) throw new Error("ml_ads_sem_anunciante");

  const q = (offset: number) => `date_from=${from}&date_to=${to}&metrics=${metrics}&limit=50&offset=${offset}`;

  // 1) Anúncios direto. "ads" é o recurso que traz o MLB do item — "items" vinha
  //    vazio e nos jogava no fallback de campanha (sem MLB, o "Geral" zerava).
  const direto = await buscar(
    (o) => [`${base(adv)}/ads/search?${q(o)}`, `${base(adv)}/items/search?${q(o)}`, `${legado(adv)}/items?${q(o)}`],
    token,
  );
  if (direto.length > 0) return direto;

  // 2) Sem itens: pega as campanhas e busca os itens de cada uma
  const camps = await buscar(
    (o) => [`${base(adv)}/campaigns/search?${q(o)}`, `${legado(adv)}/campaigns?${q(o)}`],
    token,
  );
  const ids = camps.map((c) => String(c.id ?? c.campaign_id ?? "")).filter(Boolean);
  if (ids.length === 0) throw new Error("ml_ads_sem_dados: nenhum item e nenhuma campanha retornados");

  const out: Record<string, unknown>[] = [];
  for (const cid of ids) {
    const qc = (offset: number) => `${q(offset)}&filters[campaign_id]=${encodeURIComponent(cid)}`;
    const rows = await buscar(
      (o) => [
        `${base(adv)}/ads/search?${qc(o)}`,
        `${base(adv)}/campaigns/${cid}/ads/search?${q(o)}`,
        `${base(adv)}/campaigns/${cid}/items/search?${q(o)}`,
        `${base(adv)}/items/search?${qc(o)}`,
        `${legado(adv)}/items?${qc(o)}`,
      ],
      token,
    );
    // Sem item: usa a própria campanha como linha (cada campanha aqui tem 1 anúncio)
    out.push(...(rows.length ? rows : camps.filter((c) => String(c.id ?? c.campaign_id ?? "") === cid)));
  }
  if (out.length === 0) throw new Error("ml_ads_sem_dados: campanhas existem mas nenhum item retornou");
  return out;
}

/**
 * Gasto de ADS (Product Ads) por item_id (MLB) no período.
 * Chave do mapa = item_id em UPPERCASE (ex.: "MLB1234567890").
 * Lança em falha — quem chama decide o que mostrar (nunca 0 como se fosse real).
 */
export async function getAdsSpendByItem(
  uid: string, from: string, to: string, mlbs: string[] = [],
): Promise<Record<string, number>> {
  const token = await getValidMlAccessToken(uid);
  const rows = await resolverMlb(uid, await adItemRows(uid, from, to, "cost"), token, mlbs);
  const adsByItem: Record<string, number> = {};
  for (const row of rows) {
    const itemId = itemIdDe(row);
    if (itemId) adsByItem[itemId] = (adsByItem[itemId] ?? 0) + metrica(row, "cost");
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
  directSales: number; // receita das vendas DIRETAS do anúncio
  directUnits: number; // unidades diretas
  indirectSales: number;
};

const AD_METRICS = "clicks,prints,ctr,cost,cpc,acos,cvr,total_amount,direct_amount,indirect_amount,direct_items_quantity,advertising_items_quantity";

/** Métricas COMPLETAS de Product Ads por item no período (pra aba de análise). */
export async function getAdsFullByItem(
  uid: string, from: string, to: string, mlbs: string[] = [],
): Promise<AdItemFull[]> {
  const token = await getValidMlAccessToken(uid);
  let rows: Record<string, unknown>[];
  try {
    rows = await adItemRows(uid, from, to, AD_METRICS);
  } catch (e) {
    // Uma métrica inválida derruba a busca inteira → tenta o conjunto essencial.
    if (String(e).includes("ml_ads_http_4")) rows = await adItemRows(uid, from, to, "clicks,prints,ctr,cost,cpc,acos");
    else throw e;
  }
  rows = await resolverMlb(uid, rows, token, mlbs);
  return rows.map((row) => ({
    itemId: itemIdDe(row),
    title: String(row.title ?? row.name ?? row.campaign_name ?? ""),
    status: String(row.status ?? ""),
    clicks: metrica(row, "clicks"),
    prints: metrica(row, "prints"),
    ctr: metrica(row, "ctr"),
    cost: metrica(row, "cost"),
    cpc: metrica(row, "cpc"),
    acos: metrica(row, "acos"),
    cvr: metrica(row, "cvr"),
    sales: metrica(row, "total_amount"),
    units: metrica(row, "advertising_items_quantity"),
    directSales: metrica(row, "direct_amount"),
    directUnits: metrica(row, "direct_items_quantity"),
    indirectSales: metrica(row, "indirect_amount"),
  }));
}

/** Diagnóstico: mostra o que cada rota respondeu, com um trecho do corpo. */
export async function probeAds(uid: string, from: string, to: string): Promise<Record<string, unknown>> {
  try {
    const token = await getValidMlAccessToken(uid);
    const advRes = await fetch(`${ML_API}/advertising/advertisers?product_id=PADS`, {
      headers: { Authorization: `Bearer ${token}`, "Api-Version": "1" },
      cache: "no-store",
    });
    const advBody = await advRes.json().catch(() => null);
    const advertisers = (advBody as { advertisers?: Advertiser[] })?.advertisers ?? [];
    const chosen = advertisers.find((a) => String(a?.site_id ?? "").toUpperCase() === "MLB") ?? advertisers[0];
    const advertiserId = chosen?.advertiser_id ?? null;
    const site = String(chosen?.site_id ?? "MLB").toUpperCase();

    const tentativas: Record<string, unknown>[] = [];
    if (advertiserId != null) {
      const adv: Adv = { id: String(advertiserId), siteId: site };
      const q = `date_from=${from}&date_to=${to}&metrics=cost&limit=3`;
      const alvos: { nome: string; url: string }[] = [
        { nome: "NOVO ads/search", url: `${base(adv)}/ads/search?${q}` },
        { nome: "NOVO items/search", url: `${base(adv)}/items/search?${q}` },
        { nome: "NOVO campaigns/search", url: `${base(adv)}/campaigns/search?${q}` },
        { nome: "antigo items", url: `${legado(adv)}/items?${q}` },
      ];
      for (const a of alvos) {
        try {
          const r = await get(a.url, token);
          tentativas.push({ tentativa: a.nome, status: r.status, body: (await r.text().catch(() => "")).slice(0, 220) });
        } catch (e) {
          tentativas.push({ tentativa: a.nome, erro: String(e).slice(0, 120) });
        }
      }
    }

    return {
      periodo: { from, to },
      advertisersStatus: advRes.status,
      advertisersCount: advertisers.length,
      advertiserId,
      advertiserSite: site,
      itemsStatus: (tentativas[0]?.status as number) ?? null,
      tentativas,
    };
  } catch (e) {
    return { error: String(e) };
  }
}
