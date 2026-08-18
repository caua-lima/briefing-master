import { tenantCol } from "@/lib/tenant";
import { createNotificationEventIdempotent, markPushAttempted, markPushDelivered, markPushError } from "@/lib/notification-events";
import { sendPushToUserIfAllowed } from "@/lib/push-send";
import { buildTaskDeepLink, type SalePushPayload } from "@/lib/domain/notifications";
import { agruparLembretes, textoLembrete, type TarefaPrazo } from "@/lib/domain/task-reminders";

/**
 * Varredura diária de prazo das tarefas — o lado de I/O do
 * lib/domain/task-reminders.ts (que é puro e tem os testes).
 *
 * Roda pendurado no cron das 9h (app/api/ml/cron/route.ts) em vez de virar um
 * cron próprio: o plano Hobby da Vercel só aceita cron diário, e cada entrada
 * nova em vercel.json é mais superfície pra quebrar o deploy inteiro. Como já
 * existe uma execução diária de manhã, o lembrete pega carona nela.
 *
 * Best-effort por decisão: se isto falhar, a sincronização de pedidos do cron
 * NÃO pode cair junto. Lembrete de tarefa é útil; pedido desatualizado é grave.
 */

/** Dia de hoje no fuso de São Paulo, "yyyy-mm-dd". */
function diaBR(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date());
}

export type ResultadoLembretes = {
  dia: string;
  pessoas: number;
  enviados: number;
  jaAvisadoHoje: number;
};

export async function enviarLembretesDeTarefa(tenantId: string, diaForcado?: string): Promise<ResultadoLembretes> {
  const dia = diaForcado ?? diaBR();

  // Só o que pode virar lembrete: tarefa aberta e COM prazo. O filtro de
  // status fica no Firestore (corta a maior parte, já que quadro antigo é
  // quase todo "done") e o resto da regra fica no módulo puro.
  const snap = await tenantCol(tenantId, "tarefas").where("status", "in", ["todo", "doing"]).limit(500).get();
  const tarefas: TarefaPrazo[] = snap.docs.map((d) => {
    const t = d.data() as Partial<TarefaPrazo>;
    return {
      id: String(t.id ?? d.id),
      title: String(t.title ?? "Tarefa"),
      status: (t.status ?? "todo") as TarefaPrazo["status"],
      priority: t.priority,
      dueDate: t.dueDate,
      assignedTo: t.assignedTo,
    };
  });

  const grupos = agruparLembretes(tarefas, dia);
  let enviados = 0;
  let jaAvisadoHoje = 0;

  for (const grupo of grupos) {
    const texto = textoLembrete(grupo, dia);
    if (!texto) continue;

    // Uma notificação por pessoa POR DIA: o dedupeKey vira o id do documento,
    // então o próprio Firestore garante que a segunda execução do dia (retry
    // do cron, disparo manual pra testar) não avise de novo.
    const dedupeKey = `task_due:${grupo.email}:${dia}`;
    const destaque = grupo.atrasadas[0] ?? grupo.venceHoje[0];

    const { created, eventId } = await createNotificationEventIdempotent(tenantId, {
      type: "task_assigned",
      severity: grupo.atrasadas.length > 0 ? "warning" : "info",
      entityType: "task", entityId: destaque.id, dedupeKey,
      title: texto.title, body: texto.body,
      deepLink: buildTaskDeepLink(destaque.id),
      financialState: "unavailable",
    });

    if (!created) { jaAvisadoHoje++; continue; }

    const payload: SalePushPayload = {
      eventId, type: "task_assigned", title: texto.title, body: texto.body,
      tag: `task-due-${dia}`, deepLink: buildTaskDeepLink(destaque.id),
      timestamp: new Date().toISOString(),
    };

    await markPushAttempted(tenantId, eventId);
    try {
      const { enviados: n, bloqueadoPorPreferencia } = await sendPushToUserIfAllowed(tenantId, grupo.email, payload, "task_assigned");
      if (n > 0) { await markPushDelivered(tenantId, eventId); enviados += n; }
      else await markPushError(tenantId, eventId, bloqueadoPorPreferencia ? "bloqueado por preferência/horário silencioso" : "nenhum dispositivo registrado");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markPushError(tenantId, eventId, msg.slice(0, 160));
    }
  }

  return { dia, pessoas: grupos.length, enviados, jaAvisadoHoje };
}
