import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

function monthRangeBR(monthStr?: string) {
  let year: number, month: number;
  if (!monthStr) {
    const now = new Date();
    const brTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    year = brTime.getUTCFullYear();
    month = brTime.getUTCMonth() + 1;
  } else {
    const [y, m] = monthStr.split("-").map(Number);
    year = y; month = m;
  }
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ld = String(lastDay).padStart(2, "0");
  const start   = `${year}-${mm}-01T00:00:00.000Z`;
  const end     = `${year}-${mm}-${ld}T23:59:59.999Z`;
  const startBR = `${year}-${mm}-01T00:00:00.000-03:00`;
  const endBR   = `${year}-${mm}-${ld}T23:59:59.999-03:00`;
  return { start, end, startBR, endBR };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month") || undefined;
    const { start, end, startBR, endBR } = monthRangeBR(month);
    const db = getAdminDb();

    const [snapUTC, snapBR] = await Promise.all([
      db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_orders").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);

    const ordersMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [snapUTC, snapBR]) {
      for (const doc of snap.docs) {
        const d = doc.data();
        ordersMap.set(d.order_id ?? doc.id, d);
      }
    }
    const orders = Array.from(ordersMap.values());

    let faturamento = 0;
    for (const o of orders) {
      faturamento += Number(o.total_amount || 0);
    }

    const custosSnap = await db.collection("custos").get();
    const custosOperacionais = custosSnap.docs.reduce((s, d) => s + Number(d.data().valor || 0), 0);

    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const retMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [retUTC, retBR]) for (const doc of snap.docs) retMap.set(doc.id, doc.data());
    const devolucoes = Array.from(retMap.values()).reduce((s, r) => s + Number(r.total_amount || 0), 0);

    return NextResponse.json({
      faturamento,
      ordersCount: orders.length,
      devolucoes,
      custosOperacionais,
      start, end,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "metrics_failed", details: msg }, { status: 500 });
  }
}