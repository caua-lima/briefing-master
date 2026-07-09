import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken } from "../token";

const ML_API = "https://api.mercadolibre.com";

function normId(s: string) {
  const up = String(s).trim().toUpperCase();
  if (!up) return "";
  return up.startsWith("MLB") ? up : `MLB${up}`;
}

/** Retorna a quantidade disponível (estoque) por anúncio MLB, ao vivo do ML. */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const token = await getMlAccessToken();
    if (!token) return NextResponse.json({ error: "sem token" }, { status: 400 });
    const db = getAdminDb();

    // Coleta todos os MLBs cadastrados
    const prodSnap = await db.collection("estoque").get();
    const ids = new Set<string>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const list: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of list) { const n = normId(m); if (n) ids.add(n); }
    }
    const arr = Array.from(ids);
    const estoque: Record<string, { available: number; sold: number; status: string; price: number }> = {};

    // Multi-get de 20 em 20
    for (let i = 0; i < arr.length; i += 20) {
      const chunk = arr.slice(i, i + 20);
      const res = await fetch(
        `${ML_API}/items?ids=${chunk.join(",")}&attributes=id,available_quantity,sold_quantity,status,price`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" },
      );
      if (!res.ok) continue;
      const rows = (await res.json()) as { code?: number; body?: Record<string, unknown> }[];
      for (const row of rows) {
        const b = row?.body;
        if (!b) continue;
        const id = String(b.id ?? "").toUpperCase();
        if (!id) continue;
        estoque[id] = {
          available: Number(b.available_quantity ?? 0),
          sold: Number(b.sold_quantity ?? 0),
          status: String(b.status ?? ""),
          price: Number(b.price ?? 0),
        };
      }
    }

    return NextResponse.json({ estoque });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "estoque_ml_failed", details: msg }, { status: 500 });
  }
}
