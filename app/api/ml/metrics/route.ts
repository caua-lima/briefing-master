import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getAdsSpendByItem } from "@/lib/ml/ads";

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
};

type Aggregates = {
  faturamentoBruto: number;
  totalRetorno: number;
  totalCMV: number;
  totalEnvio: number;
  totalImposto: number;
  totalTaxasML: number;
  totalAds: number;
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

  let totalAds = 0;
  for (const [chave, a] of anunciosMap) {
    // ADS pode vir como "6577305336" ou "MLB6577305336"
    a.ads = adsByItem[chave] ?? adsByItem[`MLB${chave}`] ?? adsByItem[a.item_id.toUpperCase()] ?? 0;
    totalAds += a.ads;
    a.lucroBruto = a.retorno - a.custoProduto - a.envioFull;
    a.lucro = a.lucroBruto - a.ads - a.imposto - a.taxaML;
    a.margem = a.retorno > 0 ? (a.lucro / a.retorno) * 100 : 0;
  }

  const anuncios = Array.from(anunciosMap.values()).sort((a, b) => b.retorno - a.retorno);

  return {
    faturamentoBruto,
    totalRetorno,
    totalCMV,
    totalEnvio,
    totalImposto,
    totalTaxasML,
    totalAds,
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
    const [adsByItem, adsHoje] = await Promise.all([
      getAdsSpendByItem(fromStr, toStr).catch(() => ({} as Record<string, number>)),
      getAdsSpendByItem(hj, hj).catch(() => ({} as Record<string, number>)),
    ]);

    // ── 4. Pedidos do período + de hoje ───────────────────────
    const [orders, ordersHoje] = await Promise.all([
      loadOrders(db, start, end, startBR, endBR),
      loadOrders(db, `${hj}T00:00:00.000Z`, `${hj}T23:59:59.999Z`, `${hj}T00:00:00.000-03:00`, `${hj}T23:59:59.999-03:00`),
    ]);

    const agg = computeAggregates(orders, porMlb, porSku, adsByItem);
    const aggHoje = computeAggregates(ordersHoje, porMlb, porSku, adsHoje);

    // ── 5. Devoluções ─────────────────────────────────────────
    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const retMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [retUTC, retBR]) for (const doc of snap.docs) retMap.set(doc.id, doc.data());
    const devolucoes = Array.from(retMap.values()).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

    // ── 6. Custos operacionais ────────────────────────────────
    const custosSnap = await db.collection("custos").get();
    let custosOp = 0;
    for (const doc of custosSnap.docs) {
      const d = doc.data();
      const data = String(d.data ?? d.date ?? "");
      const freq = String(d.freq ?? d.frequency ?? "avulso");
      if (freq === "mensal" || freq === "monthly") {
        if (data.slice(0, 7) >= fromStr.slice(0, 7) && data.slice(0, 7) <= toStr.slice(0, 7))
          custosOp += Number(d.valor ?? d.amount ?? 0);
      } else {
        if (data >= fromStr && data <= toStr) custosOp += Number(d.valor ?? d.amount ?? 0);
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
      from: fromStr,
      to: toStr,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "metrics_failed", details: msg }, { status: 500 });
  }
}
