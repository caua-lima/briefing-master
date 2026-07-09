import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";

function buildRange(from?: string | null, to?: string | null) {
  if (from && to) {
    return { start: `${from}T00:00:00.000Z`, end: `${to}T23:59:59.999Z`, startBR: `${from}T00:00:00.000-03:00`, endBR: `${to}T23:59:59.999-03:00` };
  }
  const br = new Date(Date.now() - 3 * 3600 * 1000);
  const y = br.getUTCFullYear();
  const m = br.getUTCMonth() + 1;
  const mm = String(m).padStart(2, "0");
  const ld = String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
  return { start: `${y}-${mm}-01T00:00:00.000Z`, end: `${y}-${mm}-${ld}T23:59:59.999Z`, startBR: `${y}-${mm}-01T00:00:00.000-03:00`, endBR: `${y}-${mm}-${ld}T23:59:59.999-03:00` };
}

type OrderItem = { quantity?: number; sale_fee?: number };

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(req.url);
    const { start, end, startBR, endBR } = buildRange(url.searchParams.get("from"), url.searchParams.get("to"));
    const db = getAdminDb();

    const [snapUTC, snapBR] = await Promise.all([
      db.collection("ml_orders").where("date_created", ">=", start).where("date_created", "<=", end).get(),
      db.collection("ml_orders").where("date_created", ">=", startBR).where("date_created", "<=", endBR).get(),
    ]);
    const map = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [snapUTC, snapBR]) for (const doc of snap.docs) { const d = doc.data(); map.set(d.order_id ?? doc.id, d); }

    const hojeISO = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

    const repasses = Array.from(map.values())
      .filter((o) => {
        const st = String(o.status ?? "").toLowerCase();
        return st !== "cancelled" && st !== "invalid"; // cancelado não é repassado
      })
      .map((o) => {
        const items = (o.items as OrderItem[]) ?? [];
        const taxaML = items.reduce((s, it) => s + Number(it.sale_fee ?? 0) * Number(it.quantity ?? 1), 0);
        const envio = Number(o.shipping_cost ?? 0);
        const bruto = Number(o.total_amount ?? 0);
        const liquido = bruto - taxaML - envio; // estimativa do que cai no Mercado Pago
        const repasseEm = String(o.money_release_date ?? "").slice(0, 10);
        const status: "liberado" | "pendente" | "sem_data" =
          !repasseEm ? "sem_data" : repasseEm <= hojeISO ? "liberado" : "pendente";
        const produtos = (o.items as { title?: string }[] ?? []).map((it) => it.title).filter(Boolean).join(", ");
        return {
          order_id: String(o.order_id ?? ""),
          data: String(o.date_created ?? "").slice(0, 10),
          produto: produtos,
          bruto,
          taxaML,
          envio,
          liquido,
          repasseEm,
          status,
        };
      })
      .sort((a, b) => (a.repasseEm || "9999").localeCompare(b.repasseEm || "9999"));

    const resumo = repasses.reduce(
      (acc, r) => {
        acc.bruto += r.bruto;
        acc.liquido += r.liquido;
        if (r.status === "liberado") acc.liberado += r.liquido;
        else if (r.status === "pendente") acc.aReceber += r.liquido;
        else acc.semData += r.liquido;
        return acc;
      },
      { bruto: 0, liquido: 0, liberado: 0, aReceber: 0, semData: 0, count: repasses.length },
    );

    // Agenda: soma por data de repasse (só os que têm data), ordenada.
    const agendaMap = new Map<string, { data: string; liquido: number; pedidos: number; pendente: boolean }>();
    for (const r of repasses) {
      if (!r.repasseEm) continue;
      const cur = agendaMap.get(r.repasseEm) ?? { data: r.repasseEm, liquido: 0, pedidos: 0, pendente: r.status === "pendente" };
      cur.liquido += r.liquido;
      cur.pedidos += 1;
      cur.pendente = cur.pendente || r.status === "pendente";
      agendaMap.set(r.repasseEm, cur);
    }
    const agenda = Array.from(agendaMap.values()).sort((a, b) => a.data.localeCompare(b.data));

    return NextResponse.json({ repasses, resumo, agenda });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "financeiro_failed", details: msg }, { status: 500 });
  }
}
