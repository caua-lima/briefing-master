import { NextResponse } from "next/server";
import { getValidMlAccessToken, tenantCol, tenantPorSellerId } from "@/lib/tenant";
import { buildPayload, enviarEPersistirEntrega, notificarVendaConfirmada } from "@/lib/ml/notificar-venda";
import { mapOrderItems } from "@/lib/ml/sync";
import { createNotificationEventIdempotent } from "@/lib/notification-events";
import { buildCancelContent, buildOrderDeepLink } from "@/lib/domain/notifications";

export const maxDuration = 30;

const ML_API = "https://api.mercadolibre.com";

/**
 * Trilha de TODA chamada recebida do Mercado Livre, POR TENANT.
 *
 * Existe porque "nao chega notificacao" era impossivel de diagnosticar: sem
 * registro nenhum, nao dava pra distinguir "o ML nunca chamou" (webhook nao
 * cadastrado, topico nao assinado, URL de outro deploy) de "o ML chamou e nos
 * quebramos". Sao problemas opostos e a correcao de um nao ajuda no outro.
 *
 * Escopado no tenant, como todo o resto: a trilha de um cliente nunca aparece
 * pro outro. Guarda so metadado — nunca token, nunca corpo completo.
 */
async function registrarChamada(tenantId: string, dados: Record<string, unknown>) {
  try {
    await tenantCol(tenantId, "webhook_log").add({
      ...dados,
      at: new Date().toISOString(),
      ts: Date.now(),
    });
  } catch { /* log nunca pode derrubar o webhook */ }
}

/**
 * Callback de notificações do Mercado Livre (tópico `orders_v2`). Precisa
 * ser cadastrado manualmente no painel de Developers do ML — não é algo que
 * dá pra configurar por código, é do lado do ML.
 *
 * O ML manda só um ponteiro (`resource`) a cada mudança no pedido — criação,
 * pagamento aprovado, troca de status de envio, etc. — então este endpoint
 * dispara VÁRIAS vezes pro mesmo pedido ao longo da vida dele.
 *
 * Idempotência: cada evento de negócio (venda confirmada, cancelamento) vira
 * um doc em `notification_events` cujo ID É o dedupeKey — o Firestore
 * garante, via `DocumentReference.create()`, que só a PRIMEIRA chamada cria
 * o doc. Chamadas repetidas (retry do ML, ou o webhook disparando de novo
 * por causa de outra mudança no mesmo pedido) recebem `created: false` e
 * simplesmente não mandam push de novo — sem precisar de transação própria
 * pra isso (ver lib/notification-events.ts).
 */
export async function POST(req: Request) {
  let body: { resource?: string; topic?: string; user_id?: string | number } | null = null;
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

  /**
   * DE QUAL TENANT É ESTE PEDIDO — o bloqueio de segurança #1 da auditoria.
   *
   * O ML manda `user_id` em toda notificação: é o seller dono da conta que
   * está inscrita no tópico, não algo que o requisitante escolhe. Resolvido
   * via tenantPorSellerId (lib/tenant.ts), que consulta quem gravou aquele
   * seller_id na própria conexão — nunca aceita um tenantId vindo do corpo
   * da requisição, que poderia ser forjado.
   *
   * Sem `user_id`, ou sem tenant que reivindique aquele seller: RECUSA. Antes
   * disto o webhook usava a única conta configurada, sem checar nada — o
   * pedido de qualquer cliente seria gravado ali, e notificado pro dono
   * errado.
   */
  const sellerId = String(body?.user_id ?? "").trim();
  if (!sellerId) return NextResponse.json({ ok: true, ignored: true, motivo: "sem_user_id" });
  const tenantId = await tenantPorSellerId(sellerId);
  if (!tenantId) {
    console.error("[webhook] nenhum tenant reivindica o seller", { sellerId, orderId });
    return NextResponse.json({ ok: true, ignored: true, motivo: "tenant_nao_resolvido" });
  }

  try {
    const token = await getValidMlAccessToken(tenantId);
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
    const items = mapOrderItems(order);
    const primeiro = items[0]?.title || "Pedido";

    const ref = tenantCol(tenantId, "ml_orders").doc(orderId);
    const antes = await ref.get();
    const jaEstavaPago = antes.exists && antes.data()?.status === "paid";

    // Mantém o dashboard atualizado mesmo em chamadas que não geram evento
    // (troca de status de envio, etc.) — sincronização completa (frete,
    // repasse) continua vindo do cron/sync manual, isto aqui é só o essencial.
    await ref.set({
      order_id: orderId,
      status: order.status ?? null,
      date_created: String(order.date_created ?? ""),
      total_amount: Number(order.total_amount ?? 0),
      currency: order.currency_id ?? "BRL",
      /**
       * buyer_id é o que permite calcular taxa de recompra (ver
       * lib/domain/repurchase.ts). lib/ml/sync.ts já gravava, mas o webhook
       * NÃO — então todo pedido que entrou por aqui e nunca passou por um
       * sync completo ficava sem comprador e sumia da conta de compradores
       * únicos, jogando a taxa pra baixo. Como é o webhook que registra as
       * vendas em tempo real, isso atingia justamente os pedidos recentes.
       */
      // Spread condicional, NAO `buyer_id: ... : null`: a gravacao usa
      // { merge: true }, entao escrever null APAGARIA o buyer_id que um sync
      // completo ja tivesse salvo. Quando o webhook nao traz o comprador, o
      // certo e nao tocar no campo.
      ...(((order.buyer as Record<string, unknown> | undefined)?.id)
        ? { buyer_id: String((order.buyer as Record<string, unknown>).id) }
        : {}),
      items,
      pack_id: order.pack_id ? String(order.pack_id) : null,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    /**
     * ── Venda confirmada ──
     *
     * Toda a regra (idade, classificacao, dedupe, agrupamento, push) vive em
     * lib/ml/notificar-venda.ts — a MESMA funcao que o sync usa como rede de
     * seguranca. Duplicar aqui era o que permitia os dois caminhos divergirem.
     *
     * A condicao deixou de ser `!jaEstavaPago`: aquele sinal vinha do status
     * gravado em ml_orders, que o sync sobrescreve sem criar evento nenhum —
     * corrida que silenciava o push quando o sync chegava primeiro. Quem
     * garante um push so e o dedupeKey, atomico no Firestore.
     */
    const resultadoVenda = await notificarVendaConfirmada(tenantId, {
      orderId,
      status,
      dateCreated: String(order.date_created ?? ""),
      items,
      shippingCost: typeof order.shipping_cost === "number" ? (order.shipping_cost as number) : null,
    });

    /**
     * ── Cancelamento ──
     * So avisa se a venda chegou a ser ANUNCIADA. A pergunta certa e "existe
     * evento sale_paid deste pedido?", nao "o doc estava com status paid?": o
     * sync sobrescreve esse status direto pra "cancelled", e o cancelamento de
     * uma venda que o usuario JA tinha visto passava batido.
     */
    const anunciamosAVenda = status !== "cancelled"
      ? false // nem chega a ler: so o ramo de cancelamento usa este sinal
      : jaEstavaPago || (await tenantCol(tenantId, "notification_events").doc(`sale_paid:${orderId}`).get()).exists;
    if (status === "cancelled" && anunciamosAVenda) {
      const dedupeKey = `sale_cancelled:${orderId}`;
      const valorImpacto = Number(order.total_amount ?? antes.data()?.total_amount ?? 0);
      const content = buildCancelContent(primeiro, items.length, valorImpacto);
      const { created, eventId } = await createNotificationEventIdempotent(tenantId, {
        type: "sale_cancelled", severity: "warning", entityType: "order", entityId: orderId, dedupeKey,
        title: content.title, body: content.body,
        orderId, orderExternalId: orderId,
        productName: primeiro, productCount: items.length,
        grossAmount: valorImpacto, financialState: "estimated",
        deepLink: buildOrderDeepLink(orderId),
      });
      if (created) {
        const payload = buildPayload(eventId, "sale_cancelled", content.title, content.body, {
          orderId, productName: primeiro, grossAmount: valorImpacto, financialState: "estimated", tag: `sale-${orderId}`,
        });
        await enviarEPersistirEntrega(tenantId, eventId, "sale_cancelled", payload);
      }
    }

    await registrarChamada(tenantId, {
      orderId, topic: body?.topic ?? "", status,
      resultado: resultadoVenda.estado,
      enviados: "enviados" in resultadoVenda ? resultadoVenda.enviados : null,
      ok: true,
    });
    return NextResponse.json({ ok: true, venda: resultadoVenda.estado });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Erro TEM que virar registro: sem isso, "o ML chamou e nos quebramos"
    // era indistinguivel de "o ML nunca chamou".
    await registrarChamada(tenantId, { orderId, topic: body?.topic ?? "", ok: false, erro: msg.slice(0, 300) });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// O ML às vezes bate com GET pra checar se a URL responde antes de salvar a
// configuração de notificações no painel de developers.
export async function GET() {
  return NextResponse.json({ ok: true, service: "ml-orders-webhook" });
}
