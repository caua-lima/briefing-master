import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { fetchMlUserProfileFresh } from "@/lib/ml/account";
import { calcularCompradoresPeriodo } from "@/lib/domain/repurchase";
import { calcularConcentracaoVendas } from "@/lib/domain/sales-heatmap";
import { calcularEntregasNoPrazo } from "@/lib/domain/shipping-performance";

// Cache curto — a aba não deve bater no Firestore/ML a cada foco de janela.
const cache = new Map<string, { at: number; body: Record<string, unknown> }>();
const CACHE_TTL = 5 * 60 * 1000;

// Pra saber se um comprador do período é NOVO ou está VOLTANDO, olhamos até
// 24 meses ANTES do início do período — sem isso todo comprador pareceria
// novo (nunca teríamos visto a "primeira compra" real dele).
const HISTORICO_EXTRA_MESES = 24;

function isNaoVenda(status: unknown): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "cancelled" || s === "invalid";
}

function brDayISO(offsetDays = 0): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function monthsAgoISO(months: number): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  d.setUTCMonth(d.getUTCMonth() - months);
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
    const periodoInicio = monthsAgoISO(months);
    const historicoInicio = monthsAgoISO(months + HISTORICO_EXTRA_MESES);

    const start = `${historicoInicio}T00:00:00.000Z`;
    const end = `${toStr}T23:59:59.999Z`;
    const startBR = `${historicoInicio}T00:00:00.000-03:00`;
    const endBR = `${toStr}T23:59:59.999-03:00`;

    const [snapUTC, snapBR, retUTC, retBR, perfil] = await Promise.all([
      db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_orders").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
      db.collection("ml_returns").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_returns").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
      fetchMlUserProfileFresh(),
    ]);

    const ordersMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [snapUTC, snapBR]) for (const doc of snap.docs) ordersMap.set(doc.id, doc.data());

    // Cancelamento/devolução não é venda de verdade — mesmo critério do
    // resto do app. Conservador: exclui até devolução ainda em disputa.
    const excluidos = new Set<string>();
    for (const snap of [retUTC, retBR]) for (const doc of snap.docs) excluidos.add(doc.id);

    const validos = Array.from(ordersMap.entries())
      .filter(([id, d]) => !excluidos.has(id) && !isNaoVenda(d.status))
      .map(([, d]) => ({
        buyer_id: (d.buyer_id as string | null | undefined) ?? null,
        date_created: String(d.date_created ?? ""),
        estimatedDelivery: d.estimated_delivery ? String(d.estimated_delivery) : undefined,
        dateDelivered: d.date_delivered ? String(d.date_delivered) : undefined,
      }));

    // Compradores usa o histórico ESTENDIDO (pra saber quem já comprava antes).
    const compradores = calcularCompradoresPeriodo(validos, periodoInicio, toStr);

    // Heatmap e entregas usam só o que caiu DENTRO do período pedido.
    const noPeriodo = validos.filter((o) => {
      const dia = o.date_created.slice(0, 10);
      return dia >= periodoInicio && dia <= toStr;
    });
    const heatmap = calcularConcentracaoVendas(noPeriodo);
    const entregas = calcularEntregasNoPrazo(noPeriodo);

    const body = {
      months,
      from: periodoInicio,
      to: toStr,
      compradores,
      heatmap,
      entregas,
      reputacao: (perfil?.seller_reputation as Record<string, unknown> | undefined) ?? null,
      reputacaoIndisponivel: perfil == null,
    };
    cache.set(cacheKey, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "desempenho_failed", details: msg }, { status: 500 });
  }
}
