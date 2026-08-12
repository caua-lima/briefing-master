import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { calcularTaxaRecompra, recompraTemDadosSuficientes } from "@/lib/domain/repurchase";

// Cache curto — a taxa não muda pedido a pedido, e ler ml_orders inteiro a
// cada abertura da tela custaria caro em leitura do Firestore.
const cache = new Map<string, { at: number; body: Record<string, unknown> }>();
const CACHE_TTL = 5 * 60 * 1000;

function isNaoVenda(status: unknown): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "cancelled" || s === "invalid";
}

function brDayISO(offsetDays = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const monthsParam = Number(url.searchParams.get("months") ?? "12");
    const months = Number.isFinite(monthsParam) && monthsParam > 0 ? monthsParam : 12;

    const cacheKey = String(months);
    const bust = url.searchParams.get("fresh") === "1";
    if (!bust) {
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.at < CACHE_TTL) {
        return NextResponse.json({ ...cached.body, cached: true });
      }
    }

    const db = getAdminDb();
    const toStr = brDayISO();
    const from = new Date(Date.now() - 3 * 3600 * 1000);
    from.setUTCMonth(from.getUTCMonth() - months);
    const fromStr = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}-${String(from.getUTCDate()).padStart(2, "0")}`;

    const start = `${fromStr}T00:00:00.000Z`;
    const end = `${toStr}T23:59:59.999Z`;
    const startBR = `${fromStr}T00:00:00.000-03:00`;
    const endBR = `${toStr}T23:59:59.999-03:00`;

    const [snapUTC, snapBR] = await Promise.all([
      db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_orders").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const ordersMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [snapUTC, snapBR]) for (const doc of snap.docs) ordersMap.set(doc.id, doc.data());

    // Cancelamento/devolução não é venda de verdade — mesmo critério usado no
    // resto do app (metrics/pedidos): pedido revertido não conta como
    // comportamento de recompra. Aqui simplificamos e excluímos qualquer
    // registro em ml_returns (mesmo em disputa ainda aberta) — é mais
    // conservador do que contar um pedido que pode ser revertido.
    const [retUTC, retBR] = await Promise.all([
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const excluidos = new Set<string>();
    for (const snap of [retUTC, retBR]) for (const doc of snap.docs) excluidos.add(doc.id);

    const validos = Array.from(ordersMap.entries())
      .filter(([id, d]) => !excluidos.has(id) && !isNaoVenda(d.status))
      .map(([, d]) => ({ buyer_id: (d.buyer_id as string | null | undefined) ?? null }));

    const resultado = calcularTaxaRecompra(validos);
    const dadosSuficientes = recompraTemDadosSuficientes(resultado.compradoresUnicos);

    const body = { ...resultado, dadosSuficientes, months, from: fromStr, to: toStr };
    cache.set(cacheKey, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "recompra_failed", details: msg }, { status: 500 });
  }
}
