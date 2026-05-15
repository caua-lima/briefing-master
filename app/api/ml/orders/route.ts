// app/api/ml/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getOrdersForDay, refreshAccessToken } from "@/lib/ml/client";

type MlToken = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
  updated_at: string;
};

type MlOrderItemRow = {
  mlb: string;
  title: string;
  vendas: number;
  faturamento: number;
  retorno: number;
};

type MlSearchOrder = {
  status: string;
  order_items?: Array<{
    item?: { id?: string; title?: string };
    quantity?: number;
    unit_price?: number;
  }>;
};

const REFRESH_BUFFER_MS = 60_000;

async function loadValidToken(): Promise<MlToken> {
  const snap = await adminDb.collection("ml_tokens").doc("main").get();
  if (!snap.exists) {
    throw new Error("Mercado Livre não conectado. Acesse /api/ml/auth.");
  }
  const token = snap.data() as MlToken;

  const expiresAt = Date.parse(token.updated_at) + token.expires_in * 1000;
  if (Date.now() < expiresAt - REFRESH_BUFFER_MS) return token;

  const refreshed = await refreshAccessToken(token.refresh_token);
  const next: MlToken = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token ?? token.refresh_token,
    expires_in: refreshed.expires_in,
    user_id: String(refreshed.user_id ?? token.user_id),
    updated_at: new Date().toISOString(),
  };
  await adminDb.collection("ml_tokens").doc("main").set(next);
  return next;
}

// Date in São Paulo (UTC-3) as YYYY-MM-DD
function todayISO(): string {
  const shifted = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get("date") || todayISO();
    const token = await loadValidToken();

    const data = await getOrdersForDay(token.access_token, token.user_id, date);
    const orders: MlSearchOrder[] = Array.isArray(data?.results) ? data.results : [];

    const byMlb = new Map<string, MlOrderItemRow>();
    for (const order of orders) {
      for (const oi of order.order_items ?? []) {
        const id = oi.item?.id;
        if (!id) continue;
        const qty = oi.quantity ?? 0;
        const unit = oi.unit_price ?? 0;
        const row = byMlb.get(id) ?? {
          mlb: id,
          title: oi.item?.title ?? id,
          vendas: 0,
          faturamento: 0,
          retorno: 0,
        };
        row.vendas += qty;
        row.faturamento += unit * qty;
        byMlb.set(id, row);
      }
    }

    return NextResponse.json({ date, items: Array.from(byMlb.values()) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
