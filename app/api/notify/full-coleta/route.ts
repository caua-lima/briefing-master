import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { createNotificationEventIdempotent, markPushAttempted, markPushDelivered, markPushError } from "@/lib/notification-events";
import { sendSalePushToAll } from "@/lib/push-send";
import {
  buildFullColetaAgendadaContent,
  buildFullColetaRecebidaContent,
  buildFullDeepLink,
  type NotificationEventType,
  type SalePushPayload,
} from "@/lib/domain/notifications";

/**
 * Chamado pelo cliente (ColetasAgendadas.tsx) depois de registrar uma coleta
 * nova ou confirmar o recebimento — ação de dentro do próprio app, sem
 * webhook do ML pra interceptar (a API do ML não avisa "agendado"/"em
 * trânsito", ver lib/domain/full-coletas.ts). Vai pro TIME inteiro
 * (sendSalePushToAll), igual venda: estoque saindo/chegando no Full importa
 * pra todo mundo, não só pra quem registrou.
 *
 * dedupeKey = `full_coleta_{tipo}:{coletaId}` — cada coleta só pode ficar
 * "agendada" uma vez e "recebida" uma vez no ciclo de vida dela (ver
 * lib/domain/full-coletas.ts: proximaTransicao não deixa voltar atrás), então
 * a chave é naturalmente idempotente contra retry, sem precisar de janela de
 * tempo como task_assigned.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => null) as {
    coletaId?: string; productName?: string; quantidade?: number; tipo?: "agendada" | "recebida"; dataAgendada?: string;
  } | null;

  const coletaId = String(body?.coletaId ?? "").trim();
  const productName = String(body?.productName ?? "").trim();
  const quantidade = Number(body?.quantidade ?? 0);
  const tipo = body?.tipo;
  const dataAgendada = String(body?.dataAgendada ?? "");

  if (!coletaId || !productName || !quantidade || (tipo !== "agendada" && tipo !== "recebida")) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const type: NotificationEventType = tipo === "agendada" ? "full_coleta_agendada" : "full_coleta_recebida";
  const content = tipo === "agendada"
    ? buildFullColetaAgendadaContent(productName, quantidade, dataAgendada)
    : buildFullColetaRecebidaContent(productName, quantidade);
  const dedupeKey = `full_coleta_${tipo}:${coletaId}`;

  const { created, eventId } = await createNotificationEventIdempotent({
    type, severity: tipo === "recebida" ? "success" : "info",
    entityType: "full_coleta", entityId: coletaId, dedupeKey,
    title: content.title, body: content.body,
    deepLink: buildFullDeepLink(),
    financialState: "unavailable", // campo pensado pra venda; coleta não tem dado financeiro
  });
  if (!created) return NextResponse.json({ ok: true, eventId, skipped: "already_notified" });

  const payload: SalePushPayload = {
    eventId, type, title: content.title, body: content.body,
    tag: `full-coleta-${coletaId}-${tipo}`, deepLink: buildFullDeepLink(), timestamp: new Date().toISOString(),
  };

  await markPushAttempted(eventId);
  try {
    const { enviados } = await sendSalePushToAll(payload, type);
    if (enviados > 0) await markPushDelivered(eventId);
    else await markPushError(eventId, "nenhum dispositivo elegível (sem token registrado ou bloqueado por preferência)");
    return NextResponse.json({ ok: true, eventId, enviados });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markPushError(eventId, msg.slice(0, 160));
    return NextResponse.json({ ok: false, error: msg, eventId }, { status: 500 });
  }
}
