import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getValidMlAccessToken } from "@/lib/ml/getToken";
import { mapOrderItems } from "@/lib/ml/sync";
import { estimateOrderFinance, type ProdutoCusto } from "@/lib/ml/order-finance";
import { sendSalePushToAll } from "@/lib/push-send";
import { createNotificationEventIdempotent, markPushAttempted, markPushDelivered, markPushError } from "@/lib/notification-events";
import { registrarVendaNaJanela } from "@/lib/notification-groups";
import {
  buildCancelContent,
  buildGroupedSalesContent,
  buildOrderDeepLink,
  buildSaleContent,
  classifySale,
  type NotificationEventSeverity,
  type NotificationEventType,
  type SalePushPayload,
} from "@/lib/domain/notifications";

export const maxDuration = 30;

const ML_API = "https://api.mercadolibre.com";

const normSku = (s: string) => s.trim().toLowerCase();
const normId = (s: string) => s.trim().toUpperCase().replace(/^MLB/, "");

/** Custo médio + imposto de cada produto, indexado por MLB e SKU — mesmo padrão de app/api/ml/ads/route.ts. */
async function carregarProdutos(db: FirebaseFirestore.Firestore) {
  const snap = await db.collection("estoque").get();
  const porMlb = new Map<string, ProdutoCusto>();
  const porSku = new Map<string, ProdutoCusto>();
  for (const doc of snap.docs) {
    const d = doc.data();
    const entry: ProdutoCusto = { custo: Number(d.custoMedio ?? d.custo ?? 0), imposto: d.imposto, impostoFaixas: d.impostoFaixas };
    const mlbs: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
    for (const m of mlbs) { const n = normId(String(m)); if (n) porMlb.set(n, entry); }
    const sku = String(d.sku ?? "").trim();
    if (sku) porSku.set(normSku(sku), entry);
  }
  return { porMlb, porSku };
}

/**
 * Meta de margem do mês atual, se configurada — mesma lógica de "meta ativa"
 * do MetasTab (mês corrente, senão a mais recente). Só usada como limiar de
 * "margem em atenção"; sem meta configurada, classifySale já cai no
 * DEFAULT_LOW_MARGIN_THRESHOLD fixo.
 */
async function metaMargemAtual(db: FirebaseFirestore.Firestore): Promise<number | null> {
  try {
    const brNow = new Date(Date.now() - 3 * 3600 * 1000);
    const mesAtual = `${brNow.getUTCFullYear()}-${String(brNow.getUTCMonth() + 1).padStart(2, "0")}`;
    const snap = await db.collection("metasHistorico").orderBy("createdAt", "desc").get();
    const doMes = snap.docs.find((d) => d.data()?.mes === mesAtual);
    const escolhido = doMes ?? snap.docs[0];
    const v = escolhido?.data()?.metaMargem;
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Idade máxima de um pedido para ainda valer push de "venda confirmada".
 *
 * O ML dispara o webhook a cada mudança do pedido — inclusive de ENVIO, dias
 * depois da venda. Sem este teto, um pedido antigo que nunca gerou evento
 * (app fora do ar na hora, webhook cadastrado depois) viraria "venda
 * confirmada" agora, notificando algo que já foi.
 *
 * 12h cobre com folga o atraso/retry real do ML sem ressuscitar venda velha.
 */
const IDADE_MAX_VENDA_MS = 12 * 3600 * 1000;

/**
 * A venda é recente o bastante pra valer push?
 *
 * Substitui o antigo `!jaEstavaPago` (status anterior gravado em ml_orders),
 * que era uma FONTE ERRADA de "já notifiquei": o sync (cron diário e o
 * automático do Dashboard a cada 15 min, ver components/dashboard/Dashboard.tsx)
 * grava `status: "paid"` no MESMO doc sem criar evento nenhum. Quando o sync
 * chegava antes do webhook — corrida pura, decidida por segundos — o webhook
 * via "paid" e concluía que já havia notificado. A venda entrava no
 * Dashboard normalmente e o push simplesmente nunca saía: exatamente o
 * "algumas vendas chegam, outras não".
 *
 * Quem garante "só um push por pedido" é o `dedupeKey` sale_paid:{orderId}
 * em notification_events, via DocumentReference.create() — atômico no
 * Firestore, imune a corrida (ver lib/notification-events.ts). Este teto de
 * idade cuida só do outro risco: notificar venda antiga.
 */
function vendaRecente(dateCreated: string): boolean {
  const t = Date.parse(dateCreated);
  if (!Number.isFinite(t)) return true; // sem data confiável, não silencia
  return Date.now() - t <= IDADE_MAX_VENDA_MS;
}

function tipoParaSeveridade(type: NotificationEventType): NotificationEventSeverity {
  switch (type) {
    case "sale_high_value": case "sale_paid": return "success";
    case "sale_low_margin": return "warning";
    case "sale_negative_margin": case "sale_cancelled": case "return_opened": case "return_completed": return "danger";
    default: return "info";
  }
}

/** Máximos defensivos pro payload `data` do FCM (~4KB de teto) — nunca deveria chegar perto disso num pedido normal. */
const ITENS_PUSH_MAX = 15;
const ITENS_PUSH_TITULO_MAX = 80;

function buildPayload(eventId: string, type: NotificationEventType, title: string, body: string, opts: {
  orderId: string; productName?: string; grossAmount?: number; estimatedProfit?: number; estimatedMargin?: number;
  financialState?: "estimated" | "confirmed" | "unavailable"; tag: string;
  itens?: { title: string; quantity: number }[];
}): SalePushPayload {
  return {
    eventId, type, title, body, tag: opts.tag,
    orderId: opts.orderId, deepLink: buildOrderDeepLink(opts.orderId),
    productName: opts.productName,
    grossAmount: opts.grossAmount != null ? opts.grossAmount.toFixed(2) : undefined,
    estimatedProfit: opts.estimatedProfit != null ? opts.estimatedProfit.toFixed(2) : undefined,
    estimatedMargin: opts.estimatedMargin != null ? opts.estimatedMargin.toFixed(1) : undefined,
    financialState: opts.financialState,
    // Só serializa quando há de fato mais de 1 item — pedido comum (a
    // maioria) não carrega essa string à toa.
    itensJson: opts.itens && opts.itens.length > 1
      ? JSON.stringify(opts.itens.slice(0, ITENS_PUSH_MAX).map((i) => ({ title: i.title.slice(0, ITENS_PUSH_TITULO_MAX), quantity: i.quantity })))
      : undefined,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Envia o push do evento já persistido, registrando tentativa/entrega/erro
 * na trilha do próprio evento (nunca o token ou payload completo — só
 * metadados seguros, ver lib/notification-events.ts).
 */
async function enviarEPersistirEntrega(eventId: string, type: NotificationEventType, payload: SalePushPayload, isSummary = false) {
  await markPushAttempted(eventId);
  try {
    const { enviados, bloqueadosPorPreferencia } = await sendSalePushToAll(payload, type, isSummary);
    if (enviados > 0) await markPushDelivered(eventId);
    else await markPushError(eventId, bloqueadosPorPreferencia > 0 ? "todos os destinatários bloquearam por preferência/horário silencioso" : "nenhum dispositivo registrado");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markPushError(eventId, msg.slice(0, 160));
  }
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
    const items = mapOrderItems(order);
    const primeiro = items[0]?.title || "Pedido";

    const db = getAdminDb();
    const ref = db.collection("ml_orders").doc(orderId);
    const antes = await ref.get();
    const dataCriacao = String(order.date_created ?? "");
    /**
     * "Já era paga ANTES de nós existirmos como registro" — só serve pro
     * cancelamento, que precisa saber se a venda chegou a valer. Para a venda
     * em si NÃO se usa mais este sinal: ver vendaRecente() acima.
     */
    const jaConheciaComoPago = antes.exists && antes.data()?.status === "paid";

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

    // ── Venda confirmada ─────────────────────────────────────────
    // A dedupe por `sale_paid:{orderId}` é que garante um push só; aqui só
    // filtramos venda antiga (ver vendaRecente).
    if (status === "paid" && vendaRecente(dataCriacao)) {
      const [{ porMlb, porSku }, metaMargem] = await Promise.all([
        carregarProdutos(db),
        metaMargemAtual(db),
      ]);
      const finance = estimateOrderFinance(
        items, porMlb, porSku,
        typeof order.shipping_cost === "number" ? (order.shipping_cost as number) : null,
        String(order.date_created ?? new Date().toISOString()),
        metaMargem,
      );
      const { type } = classifySale(finance);
      const content = buildSaleContent({ ...finance, type, itemCount: finance.itemCount, semCadastro: finance.semCadastro });
      const severity = tipoParaSeveridade(type);
      const financialState: "estimated" | "unavailable" = finance.estimatedProfit == null ? "unavailable" : "estimated";

      // dedupeKey ESTÁVEL por pedido — sempre "sale_paid:{orderId}", nunca
      // varia com a classificação (alto valor/margem baixa/etc.): se
      // variasse, um retry que recalculasse pra um tipo diferente (ex.:
      // produto ficou vinculado entre uma chamada e outra) criaria um SEGUNDO
      // evento pro mesmo pedido — exatamente a duplicidade que isto existe
      // pra evitar.
      const dedupeKey = `sale_paid:${orderId}`;
      const { created, eventId } = await createNotificationEventIdempotent({
        type, severity, entityType: "order", entityId: orderId, dedupeKey,
        title: content.title, body: content.body,
        orderId, orderExternalId: orderId,
        productName: finance.productName, productCount: finance.itemCount, quantity: finance.quantityTotal,
        // Só grava a lista quando há mais de 1 item — pedido de 1 item não
        // precisa dela, o productName já basta.
        itens: finance.itemCount > 1 ? finance.itens : undefined,
        grossAmount: finance.grossAmount,
        estimatedProfit: finance.estimatedProfit ?? undefined,
        estimatedMargin: finance.estimatedMargin ?? undefined,
        financialState,
        deepLink: buildOrderDeepLink(orderId),
      });

      if (created) {
        const payload = buildPayload(eventId, type, content.title, content.body, {
          orderId, productName: finance.productName, grossAmount: finance.grossAmount,
          estimatedProfit: finance.estimatedProfit ?? undefined, estimatedMargin: finance.estimatedMargin ?? undefined,
          financialState, tag: `sale-${orderId}`, itens: finance.itens,
        });

        // Prejuízo/margem negativa NUNCA agrupa — precisa continuar
        // individual mesmo em pico de vendas, é o tipo de aviso que não pode
        // se perder dentro de um resumo.
        if (type === "sale_negative_margin") {
          await enviarEPersistirEntrega(eventId, type, payload);
        } else {
          const decisao = await registrarVendaNaJanela(finance.grossAmount);
          if (decisao.modo === "individual") {
            await enviarEPersistirEntrega(eventId, type, payload);
          } else if (decisao.modo === "resumo_dispara") {
            const resumo = buildGroupedSalesContent(decisao.totalNaJanela, decisao.grossAcumulado, decisao.janelaMinutos);
            const payloadResumo = buildPayload(eventId, type, resumo.title, resumo.body, {
              orderId, tag: `sales-summary-${Math.floor(Date.now() / 90000)}`,
            });
            // O evento individual desta venda já foi persistido acima (fonte
            // de verdade da Central) — o push é que vira um resumo pra não
            // empilhar 4+ notificações nativas em poucos segundos.
            await enviarEPersistirEntrega(eventId, type, payloadResumo, true);
          }
          // "resumo_silencioso": já mandou o resumo na venda que disparou o
          // agrupamento — esta aqui só soma ao contador, sem push novo.
        }
      }
    }

    /**
     * ── Cancelamento ──
     * Só avisa se a venda chegou a ser ANUNCIADA como venda. A pergunta certa
     * é "existe evento sale_paid deste pedido?", não "o doc do pedido estava
     * com status paid?": o sync sobrescreve esse status direto pra
     * "cancelled" (mesma corrida descrita em vendaRecente), e aí o
     * cancelamento de uma venda que o usuário JÁ tinha visto passava batido.
     * `jaConheciaComoPago` fica como atalho — se o doc ainda diz "paid", não
     * precisa nem ler notification_events.
     */
    const anunciamosAVenda = status !== "cancelled"
      ? false // nem chega a ler: só o ramo de cancelamento usa este sinal
      : jaConheciaComoPago ||
        (await db.collection("notification_events").doc(`sale_paid:${orderId}`).get()).exists;
    if (status === "cancelled" && anunciamosAVenda) {
      const dedupeKey = `sale_cancelled:${orderId}`;
      const valorImpacto = Number(order.total_amount ?? antes.data()?.total_amount ?? 0);
      const content = buildCancelContent(primeiro, items.length, valorImpacto);
      const { created, eventId } = await createNotificationEventIdempotent({
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
        await enviarEPersistirEntrega(eventId, "sale_cancelled", payload);
      }
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
