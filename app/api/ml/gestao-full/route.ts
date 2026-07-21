import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken } from "../token";
import { SELLER_ID } from "@/lib/ml/orders";

const ML_API = "https://api.mercadolibre.com";

function normId(s: string) {
  const up = String(s).trim().toUpperCase();
  return up ? (up.startsWith("MLB") ? up : `MLB${up}`) : "";
}

type Item = { mlb: string; title: string; available: number; sold: number; status: string; inventory_id: string };

/**
 * Gestão Full: estoque por anúncio (disponível/vendido/status) + recebimentos
 * (inbound) do Full. A lista de "envios inbound" do print não é exposta pela
 * API pública do ML (só Seller Center), então mostramos o que a API entrega.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const token = await getMlAccessToken();
    if (!token) return NextResponse.json({ error: "sem token" }, { status: 400 });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const db = getAdminDb();

    // MLBs cadastrados
    const prodSnap = await db.collection("estoque").get();
    const ids = new Set<string>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const list: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of list) { const n = normId(m); if (n) ids.add(n); }
    }
    const arr = Array.from(ids);

    // Estoque + inventory_id via multi-get de itens
    const itens: Item[] = [];
    const inventoryIds = new Set<string>();
    for (let i = 0; i < arr.length; i += 20) {
      const chunk = arr.slice(i, i + 20);
      const res = await fetch(`${ML_API}/items?ids=${chunk.join(",")}&attributes=id,title,available_quantity,sold_quantity,status,inventory_id,shipping`, { headers, cache: "no-store" });
      if (!res.ok) continue;
      const rows = (await res.json()) as { body?: Record<string, unknown> }[];
      for (const row of rows) {
        const b = row?.body;
        if (!b) continue;
        const shipping = (b.shipping as Record<string, unknown>) ?? {};
        const logistic = String(shipping.logistic_type ?? "");
        const inv = String(b.inventory_id ?? "");
        // Só anúncios no Full (fulfillment). Agência/Flex/self ficam de fora.
        const isFull = logistic === "fulfillment" || (logistic === "" && inv !== "");
        if (!isFull) continue;
        if (inv) inventoryIds.add(inv);
        itens.push({
          mlb: String(b.id ?? "").toUpperCase(),
          title: String(b.title ?? ""),
          available: Number(b.available_quantity ?? 0),
          sold: Number(b.sold_quantity ?? 0),
          status: String(b.status ?? ""),
          inventory_id: inv,
        });
      }
    }
    itens.sort((a, b) => b.available - a.available);

    // Recebimentos (inbound) por inventory_id — best-effort
    const invArr = Array.from(inventoryIds);
    const now = new Date(Date.now() - 3 * 3600 * 1000);
    // O ML recusa janela > 60 dias nesta busca ("Date range can't be greater
    // than 60 days"). 55 deixa folga para fuso/arredondamento de borda.
    const from = new Date(now.getTime() - 55 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    const recebimentos: { data: string; quantidade: number; inventory_id: string; tipo: string }[] = [];
    let opStatus = 0;
    let opErro = ""; // corpo do erro do ML — sem isso o diagnóstico fica cego
    let opUrl = "";
    // O ML recusou type=inbound_reception ("invalid value") mesmo estando na doc.
    // Em vez de chutar o enum, pedimos sem filtro e olhamos os tipos que vierem.
    const tiposVistos = new Set<string>();
    for (let i = 0; i < invArr.length; i += 20) {
      const chunk = invArr.slice(i, i + 20);
      try {
        const path =
          `/stock/fulfillment/operations/search?seller_id=${SELLER_ID}` +
          `&inventory_id=${chunk.join(",")}` +
          `&date_from=${from}&date_to=${to}&limit=100`;
        const res = await fetch(`${ML_API}${path}`, { headers, cache: "no-store" });
        opStatus = res.status;
        if (!res.ok) {
          if (!opErro) {
            opErro = (await res.text().catch(() => "")).slice(0, 300);
            opUrl = path.slice(0, 200);
          }
          continue;
        }
        const j = (await res.json()) as { results?: Record<string, unknown>[]; data?: Record<string, unknown>[] };
        for (const r of j.results ?? j.data ?? []) {
          const tipo = String(r.type ?? r.operation_type ?? "");
          tiposVistos.add(tipo);
          // Filtramos aqui, com o vocabulário real do ML, em vez de no query.
          if (!/inbound|reception|entrada/i.test(tipo)) continue;
          recebimentos.push({
            data: String(r.date_created ?? r.date ?? "").slice(0, 10),
            quantidade: Number(r.quantity ?? r.total ?? 0),
            inventory_id: String(r.inventory_id ?? ""),
            tipo,
          });
        }
      } catch { /* ignora */ }
    }
    recebimentos.sort((a, b) => b.data.localeCompare(a.data));

    const totalDisponivel = itens.reduce((s, it) => s + it.available, 0);
    const totalVendido = itens.reduce((s, it) => s + it.sold, 0);

    return NextResponse.json({ itens, recebimentos, totalDisponivel, totalVendido, temInventory: invArr.length > 0, opStatus, opErro, opUrl, tiposVistos: Array.from(tiposVistos) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "gestao_full_failed", details: msg }, { status: 500 });
  }
}
