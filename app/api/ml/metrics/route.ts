import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getAdsSpendByItem, probeAds } from "@/lib/ml/ads";
import { getMlAccessToken } from "../token";

const ML_API = "https://api.mercadolibre.com";
const SELLER_ID = process.env.ML_SELLER_ID || "2420261535";

export const maxDuration = 30;

type ProdutoData = {
  custo: number;
  imposto: number; // % sobre a venda
  mlb: string;
  name: string;
  sku: string;
};

type OrderItem = {
  sku?: string;
  item_id?: string;
  quantity?: number;
  unit_price?: number;
  sale_fee?: number;
  title?: string;
};

type AnuncioResult = {
  item_id: string;
  title: string;
  retorno: number;
  custoProduto: number;
  envioFull: number;
  imposto: number;
  taxaML: number;
  ads: number;
  lucroBruto: number;
  lucro: number;
  margem: number;
  qty: number;
  semVenda?: boolean;
};

type Aggregates = {
  faturamentoBruto: number;
  totalRetorno: number;
  totalCMV: number;
  totalEnvio: number;
  totalImposto: number;
  totalTaxasML: number;
  totalAds: number;
  adsNaoVinculado: number;
  anuncios: AnuncioResult[];
  pedidosSemVinculo: number;
  ordersCount: number;
};

function parseDateParam(p: string | null) {
  return p?.trim() || undefined;
}

function normalizeSku(s: string) {
  return s.trim().toLowerCase();
}

// Remove prefixo "MLB" e retorna apenas o número, em maiúsculas
function normalizeItemId(s: string): string {
  return s.trim().toUpperCase().replace(/^MLB/, "");
}

function buildRange(from?: string, to?: string, month?: string) {
  if (from && to) {
    return {
      start: `${from}T00:00:00.000Z`,
      end: `${to}T23:59:59.999Z`,
      startBR: `${from}T00:00:00.000-03:00`,
      endBR: `${to}T23:59:59.999-03:00`,
      fromStr: from,
      toStr: to,
    };
  }
  let year: number, mon: number;
  if (month) {
    [year, mon] = month.split("-").map(Number);
  } else {
    const br = new Date(Date.now() - 3 * 3600 * 1000);
    year = br.getUTCFullYear();
    mon = br.getUTCMonth() + 1;
  }
  const mm = String(mon).padStart(2, "0");
  const ld = String(new Date(Date.UTC(year, mon, 0)).getUTCDate()).padStart(2, "0");
  return {
    start: `${year}-${mm}-01T00:00:00.000Z`,
    end: `${year}-${mm}-${ld}T23:59:59.999Z`,
    startBR: `${year}-${mm}-01T00:00:00.000-03:00`,
    endBR: `${year}-${mm}-${ld}T23:59:59.999-03:00`,
    fromStr: `${year}-${mm}-01`,
    toStr: `${year}-${mm}-${ld}`,
  };
}

/** Lê os pedidos de um intervalo (UTC e BR) deduplicando por order_id. */
async function loadOrders(
  db: FirebaseFirestore.Firestore,
  start: string,
  end: string,
  startBR: string,
  endBR: string,
) {
  const [snapUTC, snapBR] = await Promise.all([
    db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get(),
    db.collection("ml_orders").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
  ]);
  const map = new Map<string, FirebaseFirestore.DocumentData>();
  for (const snap of [snapUTC, snapBR])
    for (const doc of snap.docs) {
      const d = doc.data();
      map.set(d.order_id ?? doc.id, d);
    }
  return Array.from(map.values());
}

/**
 * Busca pedidos AO VIVO no ML para o intervalo (evita depender da sincronização
 * para o faturamento/pedidos aparecerem). Retorna null em falha (usa fallback).
 * O frete (shipping_cost) é enriquecido do cache do Firestore depois.
 */
async function fetchOrdersLive(
  token: string,
  fromISO: string,
  toISO: string,
): Promise<FirebaseFirestore.DocumentData[] | null> {
  try {
    const all: FirebaseFirestore.DocumentData[] = [];
    let offset = 0;
    while (true) {
      const url =
        `${ML_API}/orders/search?seller=${SELLER_ID}` +
        `&order.date_created.from=${encodeURIComponent(fromISO)}` +
        `&order.date_created.to=${encodeURIComponent(toISO)}` +
        `&limit=50&offset=${offset}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as { results?: Record<string, unknown>[]; paging?: { total?: number } };
      const results = data.results ?? [];
      for (const o of results) {
        const rawItems = (o.order_items as Record<string, unknown>[]) ?? [];
        all.push({
          order_id: String(o.id),
          date_created: String(o.date_created ?? ""),
          total_amount: Number(o.total_amount ?? 0),
          shipping_id: String((o.shipping as Record<string, unknown>)?.id ?? ""),
          items: rawItems.map((it) => {
            const itemObj = (it.item as Record<string, unknown>) ?? {};
            const itemId = String(itemObj.id ?? "").trim();
            const sellerSku = String(itemObj.seller_sku ?? "").trim();
            return {
              item_id: itemId,
              sku: sellerSku || itemId,
              title: String(itemObj.title ?? ""),
              quantity: Number(it.quantity ?? 0),
              unit_price: Number(it.unit_price ?? 0),
              sale_fee: Number(it.sale_fee ?? 0),
            };
          }),
        });
      }
      const total = data.paging?.total ?? 0;
      offset += results.length;
      if (offset >= total || results.length === 0) break;
    }
    return all;
  } catch {
    return null;
  }
}

/** Lê shipping_cost já sincronizado do Firestore para os pedidos informados. */
async function readShippingCosts(
  db: FirebaseFirestore.Firestore,
  ids: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const CHUNK = 300;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const refs = ids.slice(i, i + CHUNK).filter(Boolean).map((id) => db.collection("ml_orders").doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      const v = snap.get("shipping_cost");
      if (typeof v === "number") map.set(snap.id, v);
    }
  }
  return map;
}

/**
 * Agrega pedidos: faturamento, CMV, Full (frete do pedido distribuído por
 * unidade), taxas ML, imposto e ADS por anúncio. Só itens vinculados a um
 * produto entram no cálculo de lucro.
 */
function computeAggregates(
  orders: FirebaseFirestore.DocumentData[],
  porMlb: Map<string, ProdutoData>,
  porSku: Map<string, ProdutoData>,
  adsByItem: Record<string, number>,
): Aggregates {
  let faturamentoBruto = 0;
  let totalRetorno = 0;
  let totalCMV = 0;
  let totalEnvio = 0;
  let totalImposto = 0;
  let totalTaxasML = 0;
  let pedidosSemVinculo = 0;

  const anunciosMap = new Map<string, AnuncioResult>();

  for (const o of orders) {
    faturamentoBruto += Number(o.total_amount ?? 0);
    const items = (o.items as OrderItem[]) ?? [];

    // Frete Full do pedido distribuído por unidade (envio é por pedido)
    const totalUnits = items.reduce((s, it) => s + Number(it.quantity ?? 1), 0);
    const orderShipping = Number(o.shipping_cost ?? 0);
    const envioPerUnit = totalUnits > 0 ? orderShipping / totalUnits : 0;

    let vinculado = false;

    for (const item of items) {
      const qty = Number(item.quantity ?? 1);
      const skuRaw = String(item.sku ?? "").trim();
      const itemId = String(item.item_id ?? "").trim();
      const title = String(item.title ?? skuRaw);
      const retorno = Number(item.unit_price ?? 0) * qty;
      const taxaML = Number(item.sale_fee ?? 0) * qty; // sale_fee é por unidade
      const envio = envioPerUnit * qty;

      const mlbNumPedido = normalizeItemId(itemId);
      const produto = porMlb.get(mlbNumPedido) ?? porSku.get(normalizeSku(skuRaw));

      if (produto) {
        vinculado = true;
        const cmv = produto.custo * qty;
        const imposto = retorno * (produto.imposto / 100);
        totalRetorno += retorno;
        totalCMV += cmv;
        totalEnvio += envio;
        totalImposto += imposto;
        totalTaxasML += taxaML;

        const chave = mlbNumPedido || skuRaw;
        const prev = anunciosMap.get(chave);
        if (prev) {
          prev.retorno += retorno;
          prev.custoProduto += cmv;
          prev.envioFull += envio;
          prev.imposto += imposto;
          prev.taxaML += taxaML;
          prev.qty += qty;
        } else {
          anunciosMap.set(chave, {
            item_id: itemId || skuRaw,
            title: produto.name || title,
            retorno,
            custoProduto: cmv,
            envioFull: envio,
            imposto,
            taxaML,
            ads: 0,
            lucroBruto: 0,
            lucro: 0,
            margem: 0,
            qty,
          });
        }
      }
    }
    if (!vinculado && items.length > 0) pedidosSemVinculo++;
  }

  const usedAdKeys = new Set<string>();
  for (const [chave, a] of anunciosMap) {
    // adsByItem tem chaves em MLB uppercase (ex.: "MLB6577305336")
    const candidates = [chave, `MLB${chave}`, a.item_id.toUpperCase()];
    let ads = 0;
    for (const c of candidates) {
      if (adsByItem[c] != null) { ads = adsByItem[c]; usedAdKeys.add(c); break; }
    }
    a.ads = ads;
    a.lucroBruto = a.retorno - a.custoProduto - a.envioFull;
    a.lucro = a.lucroBruto - a.ads - a.imposto - a.taxaML;
    a.margem = a.retorno > 0 ? (a.lucro / a.retorno) * 100 : 0;
  }

  // Anúncios com gasto de ADS mas SEM venda no período → viram linhas próprias
  for (const [key, cost] of Object.entries(adsByItem)) {
    if (cost <= 0 || usedAdKeys.has(key)) continue;
    const prod = porMlb.get(normalizeItemId(key));
    anunciosMap.set(`__semvenda_${key}`, {
      item_id: key,
      title: prod?.name || `Anúncio ${key}`,
      retorno: 0, custoProduto: 0, envioFull: 0, imposto: 0, taxaML: 0,
      ads: cost, lucroBruto: 0, lucro: -cost, margem: 0, qty: 0,
      semVenda: true,
    });
  }

  // ADS total = TODO o investimento do período (agora todo representado em linhas)
  const totalAdsFull = Object.values(adsByItem).reduce((s, v) => s + v, 0);
  const adsNaoVinculado = 0;

  // vendidos primeiro (por retorno), depois os "sem venda" (por ADS)
  const anuncios = Array.from(anunciosMap.values()).sort(
    (a, b) => (b.retorno - a.retorno) || (b.ads - a.ads),
  );

  return {
    faturamentoBruto,
    totalRetorno,
    totalCMV,
    totalEnvio,
    totalImposto,
    totalTaxasML,
    totalAds: totalAdsFull,
    adsNaoVinculado,
    anuncios,
    pedidosSemVinculo,
    ordersCount: orders.length,
  };
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const from = parseDateParam(url.searchParams.get("from"));
    const to = parseDateParam(url.searchParams.get("to"));
    const month = parseDateParam(url.searchParams.get("month"));
    const { start, end, startBR, endBR, fromStr, toStr } = buildRange(from, to, month);
    const db = getAdminDb();

    // ── 1. Estoque: indexar por MLB (sem prefixo) e por SKU ───
    const prodSnap = await db.collection("estoque").get();
    const porMlb = new Map<string, ProdutoData>();
    const porSku = new Map<string, ProdutoData>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const entry: ProdutoData = {
        custo: Number(d.custo ?? d.cost ?? 0),
        imposto: Number(d.imposto ?? d.tax ?? 0),
        mlb: String(d.mlb ?? "").trim(),
        name: String(d.name ?? ""),
        sku: String(d.sku ?? "").trim(),
      };
      const mlbNum = normalizeItemId(entry.mlb);
      if (mlbNum) porMlb.set(mlbNum, entry);
      if (entry.sku) porSku.set(normalizeSku(entry.sku), entry);
    }

    // ── 2. Data de hoje (BR) para o breakdown do dia ──────────
    const brNow = new Date(Date.now() - 3 * 3600 * 1000);
    const hj = `${brNow.getUTCFullYear()}-${String(brNow.getUTCMonth() + 1).padStart(2, "0")}-${String(brNow.getUTCDate()).padStart(2, "0")}`;

    // ── 3. ADS por item_id (período + hoje) ───────────────────
    // A API de ADS rejeita datas futuras → limita o fim ao dia de hoje.
    // Chamadas SEQUENCIAIS: a 1ª aquece o cache do advertiser e evita o burst
    // paralelo que causava rate limit (ADS zerado).
    const adsTo = toStr > hj ? hj : toStr;
    const adsByItem: Record<string, number> =
      fromStr <= adsTo ? await getAdsSpendByItem(fromStr, adsTo).catch(() => ({})) : {};
    const adsHoje: Record<string, number> = await getAdsSpendByItem(hj, hj).catch(() => ({}));

    // ── 4. Pedidos do período + de hoje (AO VIVO, com fallback) ─
    const token = await getMlAccessToken();
    const fromISO = `${fromStr}T00:00:00.000-03:00`;
    const toISO = `${toStr}T23:59:59.999-03:00`;
    const hjFromISO = `${hj}T00:00:00.000-03:00`;
    const hjToISO = `${hj}T23:59:59.999-03:00`;

    let orders = token ? await fetchOrdersLive(token, fromISO, toISO) : null;
    let ordersHoje = token ? await fetchOrdersLive(token, hjFromISO, hjToISO) : null;

    // fallback para o Firestore se o fetch ao vivo falhar
    if (!orders) orders = await loadOrders(db, start, end, startBR, endBR);
    if (!ordersHoje) ordersHoje = await loadOrders(db, `${hj}T00:00:00.000Z`, `${hj}T23:59:59.999Z`, hjFromISO, hjToISO);

    // enriquece o frete (shipping_cost) a partir do cache do Firestore
    const allIds = [...orders, ...ordersHoje].map((o) => String(o.order_id ?? "")).filter(Boolean);
    const shipMap = await readShippingCosts(db, allIds);
    for (const o of orders) if (o.shipping_cost == null) o.shipping_cost = shipMap.get(String(o.order_id)) ?? 0;
    for (const o of ordersHoje) if (o.shipping_cost == null) o.shipping_cost = shipMap.get(String(o.order_id)) ?? 0;

    const agg = computeAggregates(orders, porMlb, porSku, adsByItem);
    const aggHoje = computeAggregates(ordersHoje, porMlb, porSku, adsHoje);

    // Série diária de faturamento bruto (para o gráfico de metas)
    const serieMap = new Map<string, number>();
    for (const o of orders) {
      const dia = String(o.date_created ?? "").slice(0, 10);
      if (dia) serieMap.set(dia, (serieMap.get(dia) ?? 0) + Number(o.total_amount ?? 0));
    }
    const serieDiaria = Array.from(serieMap.entries())
      .map(([data, faturamento]) => ({ data, faturamento }))
      .sort((a, b) => a.data.localeCompare(b.data));

    // Diagnóstico de ADS quando o total do período vem 0 (identifica a causa)
    const adsDiag = agg.totalAds === 0 && fromStr <= adsTo ? await probeAds(fromStr, adsTo) : null;

    // ── 5. Devoluções ─────────────────────────────────────────
    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const retMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [retUTC, retBR]) for (const doc of snap.docs) retMap.set(doc.id, doc.data());
    const devolucoes = Array.from(retMap.values()).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

    // ── 6. Custos operacionais ────────────────────────────────
    // Dias e meses cobertos pelo período selecionado
    const dFrom = new Date(`${fromStr}T00:00:00Z`).getTime();
    const dTo = new Date(`${toStr}T00:00:00Z`).getTime();
    const daysInPeriod = Math.max(1, Math.round((dTo - dFrom) / 86400000) + 1);
    const [fy, fm, fd] = fromStr.split("-").map(Number);
    const [ty, tm, td] = toStr.split("-").map(Number);
    // Custo MENSAL só entra em períodos que cobrem mês(es) completo(s).
    // Assim ele NÃO polui o lucro de "Hoje"/dias avulsos (é um custo do mês).
    const lastDayFrom = new Date(Date.UTC(fy, fm, 0)).getUTCDate();
    const isFullMonth = fy === ty && fm === tm && fd === 1 && td === lastDayFrom;
    const monthsInPeriod = Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);

    const custosSnap = await db.collection("custos").get();
    let custosOp = 0;
    for (const doc of custosSnap.docs) {
      const d = doc.data();
      const valor = Number(d.valor ?? d.amount ?? 0);
      const data = String(d.data ?? d.date ?? "");
      const freq = String(d.freq ?? d.frequency ?? "avulso");
      if (freq === "diario" || freq === "daily") {
        custosOp += valor * daysInPeriod;                 // desconta todo dia
      } else if (freq === "mensal" || freq === "monthly") {
        if (isFullMonth) custosOp += valor * monthsInPeriod; // só no mês completo
      } else if (data >= fromStr && data <= toStr) {
        custosOp += valor;                                 // avulso: só na data
      }
    }

    // ── 7. Lucro líquido do dia (retorno − cmv − full − ads − taxas − imposto) ──
    const lucroLiquidoHoje =
      aggHoje.totalRetorno - aggHoje.totalCMV - aggHoje.totalEnvio - aggHoje.totalAds - aggHoje.totalTaxasML - aggHoje.totalImposto;

    // ── 8. Totais finais do período ───────────────────────────
    const lucroSemCustos =
      agg.totalRetorno - agg.totalCMV - agg.totalEnvio - agg.totalAds - agg.totalImposto - agg.totalTaxasML - devolucoes;
    const lucroComCustos = lucroSemCustos - custosOp;
    const margemSemCustos = agg.totalRetorno > 0 ? (lucroSemCustos / agg.totalRetorno) * 100 : 0;
    const margemComCustos = agg.totalRetorno > 0 ? (lucroComCustos / agg.totalRetorno) * 100 : 0;

    return NextResponse.json({
      faturamentoBruto: agg.faturamentoBruto,
      totalRetorno: agg.totalRetorno,
      faturamentoHoje: aggHoje.faturamentoBruto,
      pedidosHoje: aggHoje.ordersCount,
      ordersCount: agg.ordersCount,
      devolucoes,
      totalCMV: agg.totalCMV,
      totalAds: agg.totalAds,
      adsNaoVinculado: agg.adsNaoVinculado,
      totalEnvio: agg.totalEnvio,
      totalImposto: agg.totalImposto,
      totalTaxasML: agg.totalTaxasML,
      custosOperacionais: custosOp,
      lucroSemCustos,
      lucroComCustos,
      margemSemCustos,
      margemComCustos,
      anuncios: agg.anuncios,
      pedidosSemVinculo: agg.pedidosSemVinculo,
      // Breakdown do dia para o card "Vendas do Dia"
      hoje: {
        faturamentoBruto: aggHoje.faturamentoBruto,
        totalCMV: aggHoje.totalCMV,
        totalAds: aggHoje.totalAds,
        totalEnvio: aggHoje.totalEnvio,
        totalTaxasML: aggHoje.totalTaxasML,
        totalImposto: aggHoje.totalImposto,
        lucroLiquido: lucroLiquidoHoje,
        pedidos: aggHoje.ordersCount,
      },
      serieDiaria,
      adsDiag,
      from: fromStr,
      to: toStr,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "metrics_failed", details: msg }, { status: 500 });
  }
}
