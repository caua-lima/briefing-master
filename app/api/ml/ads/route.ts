import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getAdsFullByItem, probeAds } from "@/lib/ml/ads";
import { getValidMlAccessToken } from "@/lib/ml/getToken";
import { fetchOrdersLive, loadOrders, readShippingCosts } from "@/lib/ml/orders";

export const maxDuration = 30;

type ProdutoData = { custo: number; imposto: number };
type OrderItem = { sku?: string; item_id?: string; quantity?: number; unit_price?: number; sale_fee?: number };

function todayISO(offsetDays = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 - offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
const normSku = (s: string) => s.trim().toLowerCase();
const normId = (s: string) => s.trim().toUpperCase().replace(/^MLB/, "");
const isNaoVenda = (s: unknown) => {
  const v = String(s ?? "").toLowerCase();
  return v === "cancelled" || v === "invalid";
};

type VendaItem = { receita: number; unidades: number; cmv: number; imposto: number; taxaML: number; envio: number };

/**
 * Vendas + lucro (antes de ads) por item MLB, a partir dos MESMOS pedidos que o
 * dashboard usa (ao vivo do ML). Exclui cancelados e devolvidos, igual ao lucro
 * do dashboard — assim "vendas totais" e "lucro" batem com a tela principal.
 */
function vendasPorItem(
  orders: FirebaseFirestore.DocumentData[],
  porMlb: Map<string, ProdutoData>, porSku: Map<string, ProdutoData>,
  cancelIds: Set<string>, devolIds: Set<string>,
): Map<string, VendaItem> {
  const map = new Map<string, VendaItem>();
  for (const o of orders) {
    const oid = String(o.order_id ?? "");
    if (isNaoVenda(o.status) || cancelIds.has(oid) || devolIds.has(oid)) continue;
    const items = (o.items as OrderItem[]) ?? [];
    const totalUnits = items.reduce((s, it) => s + Number(it.quantity ?? 1), 0);
    const envioPerUnit = totalUnits > 0 ? Number(o.shipping_cost ?? 0) / totalUnits : 0;
    for (const it of items) {
      const id = String(it.item_id ?? "").trim().toUpperCase();
      if (!id) continue;
      const qty = Number(it.quantity ?? 1);
      const receita = Number(it.unit_price ?? 0) * qty;
      const prod = porMlb.get(normId(id)) ?? porSku.get(normSku(String(it.sku ?? "")));
      const cur = map.get(id) ?? { receita: 0, unidades: 0, cmv: 0, imposto: 0, taxaML: 0, envio: 0 };
      cur.receita += receita;
      cur.unidades += qty;
      cur.taxaML += Number(it.sale_fee ?? 0) * qty;
      cur.envio += envioPerUnit * qty;
      cur.cmv += (prod?.custo ?? 0) * qty;
      cur.imposto += receita * ((prod?.imposto ?? 0) / 100);
      map.set(id, cur);
    }
  }
  return map;
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || todayISO(29);
    const to = url.searchParams.get("to") || todayISO(0);

    // A API de ADS do ML rejeita datas futuras (404) → limita o fim ao dia de
    // hoje no fuso BR. Mesma trava que o dashboard já usa.
    const hj = todayISO(0);
    const adsTo = to > hj ? hj : to;

    let ads;
    try {
      ads = from <= adsTo ? await getAdsFullByItem(from, adsTo) : [];
    } catch {
      // O ML costuma devolver 404 quando o período termina no dia corrente (os
      // dados de hoje ainda não fecharam). Tenta de novo terminando ontem.
      const ontem = todayISO(1);
      try {
        ads = from <= ontem ? await getAdsFullByItem(from, ontem) : [];
      } catch {
        const diag = await probeAds(from, adsTo);
        return NextResponse.json({ error: "ads_failed", diag, from, to: adsTo, items: [] });
      }
    }

    const db = getAdminDb();

    // ── Produtos (custo médio + imposto) indexados por MLB e SKU ──
    const prodSnap = await db.collection("estoque").get();
    const porMlb = new Map<string, ProdutoData>();
    const porSku = new Map<string, ProdutoData>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const entry: ProdutoData = { custo: Number(d.custoMedio ?? d.custo ?? 0), imposto: Number(d.imposto ?? 0) };
      const mlbs: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of mlbs) { const n = normId(String(m)); if (n) porMlb.set(n, entry); }
      const sku = String(d.sku ?? "").trim();
      if (sku) porSku.set(normSku(sku), entry);
    }

    // ── Pedidos AO VIVO (mesma fonte do dashboard) com fallback ao Firestore ──
    const fromISO = `${from}T00:00:00.000-03:00`;
    const toISO = `${to}T23:59:59.999-03:00`;
    const start = `${from}T00:00:00.000Z`, end = `${to}T23:59:59.999Z`;
    const token = await getValidMlAccessToken().catch(() => "");
    let orders = token ? await fetchOrdersLive(token, fromISO, toISO) : null;
    if (!orders) orders = await loadOrders(db, start, end, fromISO, toISO);

    // enriquece frete do cache do Firestore
    const ids = orders.map((o) => String(o.order_id ?? "")).filter(Boolean);
    const shipMap = await readShippingCosts(db, ids);
    for (const o of orders) if (o.shipping_cost == null) o.shipping_cost = shipMap.get(String(o.order_id)) ?? 0;

    // ── Devoluções + cancelamentos (excluídos do lucro, igual ao dashboard) ──
    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", fromISO).where("date_created", "<=", toISO).get(),
    ]);
    const cancelIds = new Set<string>();
    const devolIds = new Set<string>();
    for (const snap of [retUTC, retBR]) for (const doc of snap.docs) {
      const r = doc.data();
      if (String(r.tipo ?? "") === "devolucao") devolIds.add(doc.id);
      else cancelIds.add(doc.id);
    }

    const vendas = vendasPorItem(orders, porMlb, porSku, cancelIds, devolIds);

    const items = ads.map((a) => {
      const v = vendas.get(a.itemId) ?? { receita: 0, unidades: 0, cmv: 0, imposto: 0, taxaML: 0, envio: 0 };
      const lucroAntesAds = v.receita - v.cmv - v.imposto - v.taxaML - v.envio;
      const lucroLiquido = lucroAntesAds - a.cost; // já descontando o ads
      return {
        itemId: a.itemId, title: a.title,
        clicks: a.clicks, prints: a.prints, cost: a.cost,
        directSales: a.directSales, directUnits: a.directUnits,
        adSales: a.sales, adUnits: a.units,
        totalSales: v.receita, totalUnits: v.unidades,
        lucroAntesAds, lucroLiquido,
      };
    }).sort((x, y) => y.cost - x.cost);

    return NextResponse.json({ items, from, to });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "unexpected", details: msg, items: [] }, { status: 500 });
  }
}
