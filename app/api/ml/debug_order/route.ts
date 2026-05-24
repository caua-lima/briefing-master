import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET() {
  const db = getAdminDb();

  // Pega os 3 primeiros pedidos do mês
  const snap = await db.collection("ml_orders").limit(3).get();
  const sample = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      order_id:     d.order_id,
      date_created: d.date_created,
      total_amount: d.total_amount,
      items:        d.items,
    };
  });

  // Pega os 3 primeiros produtos
  const prodSnap = await db.collection("products").limit(5).get();
  const produtos = prodSnap.docs.map((doc) => {
    const d = doc.data();
    return { id: doc.id, name: d.name, sku: d.sku, mlb: d.mlb, cost: d.cost };
  });

  return NextResponse.json({ sample_orders: sample, produtos });
}