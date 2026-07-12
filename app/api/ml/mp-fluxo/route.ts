import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";

const MP_API = "https://api.mercadopago.com";

export const maxDuration = 30;

type MpPayment = {
  id?: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  transaction_amount_refunded?: number;
  money_release_date?: string;
  money_release_status?: string;
  transaction_details?: { net_received_amount?: number };
};

// Pagamentos retidos pelo MP (disputa / análise) NÃO entram no "a receber".
const RETIDO = new Set(["in_mediation", "pending_contingency", "pending_review_manual", "in_process"]);

/**
 * Fluxo de caixa REAL do Mercado Pago via /v1/payments/search.
 * Lista os pagamentos aprovados (vendas ML + Pix) e separa o que já foi
 * liberado do que ainda vai cair (A receber = money_release_date no futuro).
 * Usa a credencial de produção do MP (MP_ACCESS_TOKEN).
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "sem_mp_token" });

  try {
    const now = Date.now();
    // "desde" (ms) = base do cofrinho; liberadoDesde = repasses que caíram depois disso.
    const desdeMs = Number(new URL(req.url).searchParams.get("desde") ?? 0) || 0;

    let offset = 0;
    const limit = 100;
    let aReceber = 0, liberado = 0, liberadoDesde = 0, pendentes = 0, count = 0, aprovados = 0;
    let retido = 0, retidos = 0, devolvidoTotal = 0; // diagnóstico do que sai do "a receber"
    let totalMp = 0; // total que o MP reporta (diagnóstico)
    const seen = new Set<string>(); // dedupe: a lista é ao vivo e pode repetir na paginação
    const agendaMap = new Map<string, { data: string; liquido: number; pedidos: number }>();

    while (offset < 5000) {
      // Filtro de data RELATIVO (NOW-90DAYS) — o formato ISO era rejeitado em
      // silêncio; o macro funciona. 90 dias cobrem todos os repasses pendentes.
      const url =
        `${MP_API}/v1/payments/search?range=date_created&begin_date=NOW-90DAYS&end_date=NOW` +
        `&sort=date_created&criteria=desc&limit=${limit}&offset=${offset}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
      if (!r.ok) {
        const details = (await r.text()).slice(0, 300);
        return NextResponse.json({ ok: false, error: "mp_search_failed", status: r.status, details });
      }
      const j = (await r.json()) as { results?: MpPayment[]; paging?: { total?: number } };
      const results = j.results ?? [];
      totalMp = j.paging?.total ?? totalMp;
      for (const p of results) {
        const pid = String(p.id ?? "");
        if (pid && seen.has(pid)) continue; // já contado numa página anterior
        if (pid) seen.add(pid);
        count++;
        if (String(p.status ?? "") !== "approved") continue;
        aprovados++;

        const gross = Number(p.transaction_amount ?? 0);
        const refunded = Number(p.transaction_amount_refunded ?? 0);
        let net = Number(p.transaction_details?.net_received_amount ?? gross);
        // Pedido devolvido/estornado → o repasse futuro é cancelado. Desconta a
        // parte devolvida do líquido (proporcional), igual o MP faz no "a receber".
        if (refunded > 0 && gross > 0) {
          const frac = Math.min(1, refunded / gross);
          devolvidoTotal += net * frac;
          net = net * (1 - frac);
        }

        const rel = String(p.money_release_date ?? "");
        const relMs = rel ? Date.parse(rel) : NaN;
        const relStatus = String(p.money_release_status ?? "");
        const detail = String(p.status_detail ?? "");
        const estaRetido = RETIDO.has(detail) || relStatus === "pending_contingency";
        const jaCaiu = relStatus === "released";
        const futuro = !jaCaiu && Number.isFinite(relMs) && relMs > now;

        if (estaRetido && futuro) {
          // MP segura esse valor (disputa/análise) → não conta no "a receber".
          retido += net;
          retidos++;
        } else if (futuro) {
          aReceber += net;
          pendentes++;
          const dia = rel.slice(0, 10);
          const cur = agendaMap.get(dia) ?? { data: dia, liquido: 0, pedidos: 0 };
          cur.liquido += net;
          cur.pedidos++;
          agendaMap.set(dia, cur);
        } else {
          liberado += net;
          if (desdeMs > 0 && Number.isFinite(relMs) && relMs >= desdeMs) liberadoDesde += net;
        }
      }
      offset += results.length;
      if (results.length === 0 || offset >= totalMp) break;
    }

    const agenda = Array.from(agendaMap.values()).sort((a, b) => a.data.localeCompare(b.data));
    return NextResponse.json({
      ok: true, via: "mp",
      aReceber, liberado, liberadoDesde, pendentes, aprovados, count, totalMp, agenda,
      retido, retidos, devolvidoTotal, // diagnóstico: o que foi tirado do "a receber"
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: "unexpected", details: msg });
  }
}
