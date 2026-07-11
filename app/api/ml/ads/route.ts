import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getAdsFullByItem, probeAds } from "@/lib/ml/ads";

export const maxDuration = 30;

type ProdutoData = { custo: number; imposto: number };
type OrderItem = { sku?: string; item_id?: string; quantity?: number; unit_price?: number; sale_fee?: number };

function todayISO(offsetDays = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 - offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
const normSku = (s: string) => s.trim().toLowerCase();
const normId = (s: string) => s.trim().toUpperCase().replace(/^MLB/, "");

type VendaItem = { receita: number; unidades: number; cmv: number; imposto: number; taxaML: number; envio: number };

/** Vendas + lucro (antes de ads) por item MLB, lidos do Firestore (todos os canais). */
async function vendasPorItem(
  db: FirebaseFirestore.Firestore, from: string, to: string,
  porMlb: Map<string, ProdutoData>, porSku: Map<string, ProdutoData>,
): Promise<Map<string, VendaItem>> {
  const start = `${from}T00:00:00.000Z`, end = `${to}T23:59:59.999Z`;
  const startBR = `${from}T00:00:00.000-03:00`, endBR = `${to}T23:59:59.999-03:00`;
  const [a, b] = await Promise.all([
    db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get(),
    db.collection("ml_orders").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
  ]);
  const orders = new Map<string, FirebaseFirestore.DocumentData>();
  for (const snap of [a, b]) for (const d of snap.docs) orders.set(d.get("order_id") ?? d.id, d.data());

  const map = new Map<string, VendaItem>();
  for (const o of orders.values()) {
    const st = String(o.status ?? "").toLowerCase();
    if (st === "cancelled" || st === "invalid") continue;
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

    let ads;
    try {
      ads = await getAdsFullByItem(from, to);
    } catch {
      const diag = await probeAds(from, to);
      return NextResponse.json({ error: "ads_failed", diag, from, to, items: [] });
    }

    const db = getAdminDb();
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
    const vendas = await vendasPorItem(db, from, to, porMlb, porSku).catch(() => new Map<string, VendaItem>());

    const items = ads.map((a) => {
      const v = vendas.get(a.itemId) ?? { receita: 0, unidades: 0, cmv: 0, imposto: 0, taxaML: 0, envio: 0 };
      const lucroAntesAds = v.receita - v.cmv - v.imposto - v.taxaML - v.envio;
      const lucroLiquido = lucroAntesAds - a.cost; // ⭐ já descontando o ads
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
