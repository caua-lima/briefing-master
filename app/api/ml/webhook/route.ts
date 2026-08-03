import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getValidMlAccessToken } from "@/lib/ml/getToken";
import { mapOrderItems } from "@/lib/ml/sync";
import { sendPushToAll } from "@/lib/push-send";

export const maxDuration = 30;

const ML_API = "https://api.mercadolibre.com";

const fmtBRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

/**
 * Callback de notificações do Mercado Livre (tópico `orders_v2`). Precisa
 * ser cadastrado manualmente no painel de Developers do ML — não é algo que
 * dá pra configurar por código, é do lado do ML.
 *
 * O ML manda só um ponteiro (`resource`) a cada mudança no pedido — criação,
 * pagamento aprovado, troca de status de envio, etc. — então este endpoint
 * dispara VÁRIAS vezes pro mesmo pedido ao longo da vida dele. Só dispara a
 * notificação push na transição pra "paid" que ainda não tinha sido vista
 * (dedupe via `notifiedPush` no Firestore) — as outras chamadas só mantêm o
 * pedido atualizado no dashboard, sem pingar de novo.
 *
 * O check+set do `notifiedPush` roda dentro de uma transação — o ML costuma
 * mandar o mesmo evento em duas chamadas quase simultâneas (reenvio/retry), e
 * um "lê depois grava" comum tem uma janela onde as duas chamadas leem
 * "ainda não notificado" antes de qualquer uma escrever, e a notificação sai
 * duplicada. A transação serializa isso: a segunda chamada só é processada
 * depois que a primeira já commitou, então já enxerga `notifiedPush: true`.
 */
export async function POST(req: Request) {
  let body: { resource?: string; topic?: string } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" });
  }

  const resource = body?.resource ?? "";
  const match = resource.match(/^\/orders\/(\d+)/);
  if (!match) {
    // outros tópicos (mensagens, reclamações, etc.) — ignora sem erro, não
    // queremos que o ML pare de mandar os outros por causa disso
    return NextResponse.json({ ok: true, ignored: true });
  }
  const orderId = match[1];

  try {
    const token = await getValidMlAccessToken();
    const res = await fetch(`${ML_API}/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      // 404 acontece com pedido de teste/sandbox do próprio ML — não é erro
      // nosso, não faz sentido o ML ficar retentando. Outros status, sim.
      return NextResponse.json({ ok: res.status === 404 }, { status: res.status === 404 ? 200 : 502 });
    }
    const order = (await res.json()) as Record<string, unknown>;
    const status = String(order.status ?? "");

    const db = getAdminDb();
    const ref = db.collection("ml_orders").doc(orderId);

    // Transação: decide "deve notificar" e já marca notifiedPush=true no
    // mesmo commit atômico, fechando a janela de corrida entre chamadas
    // concorrentes do mesmo evento.
    const deveNotificar = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const jaEstavaPago = snap.exists && snap.data()?.status === "paid";
      const jaNotificado = snap.exists && snap.data()?.notifiedPush === true;
      const notificarAgora = status === "paid" && !jaEstavaPago && !jaNotificado;

      // Grava o essencial pra já aparecer no dashboard na hora — a sincronização
      // completa (custo de frete, repasse líquido do Mercado Pago) continua vindo
      // do cron diário e do botão de sincronizar manual, então não duplica aquele
      // trabalho pesado aqui a cada notificação recebida.
      const patch: Record<string, unknown> = {
        order_id: orderId,
        status: order.status ?? null,
        date_created: String(order.date_created ?? ""),
        total_amount: Number(order.total_amount ?? 0),
        currency: order.currency_id ?? "BRL",
        items: mapOrderItems(order),
        pack_id: order.pack_id ? String(order.pack_id) : null,
        updatedAt: new Date().toISOString(),
      };
      if (notificarAgora) patch.notifiedPush = true;

      tx.set(ref, patch, { merge: true });
      return notificarAgora;
    });

    if (deveNotificar) {
      const itens = mapOrderItems(order);
      const primeiro = itens[0]?.title || "Pedido";
      const resumo = itens.length > 1 ? `${primeiro} + ${itens.length - 1} item(ns)` : primeiro;
      // orderId como chave: se dois pushes do mesmo pedido escaparem, o
      // aparelho substitui a notificação em vez de empilhar duas.
      await sendPushToAll("🎉 Nova venda!", `${resumo} — ${fmtBRL(Number(order.total_amount ?? 0))}`, orderId);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// O ML às vezes bate com GET pra checar se a URL responde antes de salvar a
// configuração de notificações no painel de developers.
export async function GET() {
  return NextResponse.json({ ok: true, service: "ml-orders-webhook" });
}
