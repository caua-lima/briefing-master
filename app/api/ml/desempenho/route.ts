import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { fetchMlUserProfileFresh } from "@/lib/ml/account";
import { calcularCompradoresPeriodo } from "@/lib/domain/repurchase";
import { calcularConcentracaoVendas } from "@/lib/domain/sales-heatmap";
import { calcularEntregasNoPrazo } from "@/lib/domain/shipping-performance";
import { avaliarRequisitosMercadoLider, type ReputationParaChecklist } from "@/lib/domain/mercadolider-requisitos";

// Cache curto — a aba não deve bater no Firestore/ML a cada foco de janela.
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

    // Compradores precisa do histórico INTEIRO (sem limite pra trás) pra saber
    // se a primeira compra de alguém foi antes do período — um teto aqui fazia
    // todo mundo parecer "novo" sempre que a conta era mais velha que o teto
    // (ou quando o histórico sincronizado nem chegava tão longe). Custo: uma
    // leitura ocasional (cache de 5min) de todos os pedidos já sincronizados,
    // não uma leitura recorrente — não é o padrão que estourou a cota antes.
    const end = `${toStr}T23:59:59.999Z`;
    const endBR = `${toStr}T23:59:59.999-03:00`;

    const [snapUTC, snapBR, retSnap, perfil] = await Promise.all([
      db.collection("ml_orders").where("date_created", "<=", end).get(),
      db.collection("ml_orders").where("date_created", "<=", endBR).get(),
      db.collection("ml_returns").get(),
      fetchMlUserProfileFresh(),
    ]);

    const ordersMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const snap of [snapUTC, snapBR]) for (const doc of snap.docs) ordersMap.set(doc.id, doc.data());

    // Cancelamento/devolução não é venda de verdade — mesmo critério do
    // resto do app. Conservador: exclui até devolução ainda em disputa.
    const excluidos = new Set<string>();
    for (const doc of retSnap.docs) excluidos.add(doc.id);

    const validos = Array.from(ordersMap.entries())
      .filter(([id, d]) => !excluidos.has(id) && !isNaoVenda(d.status))
      .map(([, d]) => ({
        buyer_id: (d.buyer_id as string | null | undefined) ?? null,
        date_created: String(d.date_created ?? ""),
        estimatedDelivery: d.estimated_delivery ? String(d.estimated_delivery) : undefined,
        dateDelivered: d.date_delivered ? String(d.date_delivered) : undefined,
      }));

    // Compradores usa o histórico INTEIRO (pra saber quem já comprava antes).
    const compradores = calcularCompradoresPeriodo(validos, periodoInicio, toStr);

    // Data mais antiga que a gente realmente tem sincronizada — se for depois
    // do início do período, "novos" está inflado (não é que ninguém recomprou,
    // é que não temos como saber; a tela avisa em vez de fingir certeza).
    const datasValidas = validos.map((o) => o.date_created.slice(0, 10)).filter(Boolean);
    const historicoDesde = datasValidas.length > 0 ? datasValidas.reduce((min, d) => (d < min ? d : min)) : null;

    // Heatmap e entregas usam só o que caiu DENTRO do período pedido.
    const noPeriodo = validos.filter((o) => {
      const dia = o.date_created.slice(0, 10);
      return dia >= periodoInicio && dia <= toStr;
    });
    const heatmap = calcularConcentracaoVendas(noPeriodo);
    const entregas = calcularEntregasNoPrazo(noPeriodo);

    const reputacao = (perfil?.seller_reputation as Record<string, unknown> | undefined) ?? null;

    const body = {
      months,
      from: periodoInicio,
      to: toStr,
      compradores,
      historicoDesde,
      heatmap,
      entregas,
      reputacao,
      reputacaoIndisponivel: perfil == null,
      registrationDate: perfil?.registration_date ?? null,
      requisitosMercadoLider: avaliarRequisitosMercadoLider(reputacao as unknown as ReputationParaChecklist | null),
    };
    cache.set(cacheKey, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "desempenho_failed", details: msg }, { status: 500 });
  }
}
