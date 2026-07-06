import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken } from "../token";

const ML_API = "https://api.mercadolibre.com";
const SELLER_ID = process.env.ML_SELLER_ID || "2420261535";

type Row = Record<string, unknown>;
function num(v: unknown) { return Number(v ?? 0) || 0; }
function str(v: unknown) { return String(v ?? "").trim(); }

/** Normaliza um envio inbound (a partir de campos variados) para a UI. */
function mapEnvio(r: Row) {
  const warehouse = (r.warehouse as Row) ?? (r.destination as Row) ?? (r.logistic_center as Row) ?? {};
  const declaradas = num(r.declared_quantity ?? r.declared ?? r.quantity ?? r.total_declared);
  const aptas = r.apt_quantity ?? r.received_quantity ?? r.received ?? r.available_quantity ?? null;
  return {
    id: str(r.id ?? r.shipment_id ?? r.inbound_id),
    status: str(r.status ?? r.substatus ?? r.state),
    declaradas,
    aptas: aptas == null ? null : num(aptas),
    warehouse: str(warehouse.name ?? warehouse.id ?? r.warehouse_id ?? r.logistic_center_id),
    dataReservada: str(r.booked_date ?? r.reserved_date ?? r.date_reserved ?? r.date_created).slice(0, 10),
    custo: num(r.applied_cost ?? r.cost ?? r.amount),
  };
}

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const token = await getMlAccessToken();
    if (!token) return NextResponse.json({ error: "sem token" }, { status: 400 });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Api-Version": "1" };

    // Tenta os endpoints prováveis de inbound do Full
    const candidatos = [
      `${ML_API}/inbound/shipments/search?seller_id=${SELLER_ID}&limit=50`,
      `${ML_API}/fbm/inbound/shipments/search?seller_id=${SELLER_ID}&limit=50`,
    ];

    let results: Row[] = [];
    let apiSource = "";
    let apiStatus = 0;
    for (const url of candidatos) {
      const res = await fetch(url, { headers, cache: "no-store" });
      apiStatus = res.status;
      if (res.ok) {
        const j = (await res.json()) as { results?: Row[]; data?: Row[] };
        results = j.results ?? j.data ?? [];
        apiSource = url;
        break;
      }
    }

    const envios = results.map(mapEnvio).sort((a, b) => b.dataReservada.localeCompare(a.dataReservada));

    const resumo = { agendados: 0, preparando: 0, aCaminho: 0, recebendo: 0, finalizado: 0, cancelado: 0, total: envios.length };
    for (const e of envios) {
      const s = e.status.toLowerCase();
      if (s.includes("cancel")) resumo.cancelado++;
      else if (s.includes("final") || s.includes("processed") || s.includes("closed")) resumo.finalizado++;
      else if (s.includes("recei") || s.includes("receb") || s.includes("pending_reception")) resumo.recebendo++;
      else if (s.includes("transit") || s.includes("shipped") || s.includes("caminho")) resumo.aCaminho++;
      else if (s.includes("prepar") || s.includes("handling") || s.includes("draft")) resumo.preparando++;
      else resumo.agendados++;
    }

    return NextResponse.json({ envios, resumo, apiSource, apiStatus });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "gestao_full_failed", details: msg }, { status: 500 });
  }
}
