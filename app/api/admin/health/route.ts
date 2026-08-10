import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireAccess } from "@/lib/api-auth";
import { getAdminDb, getAdminSecurityRules } from "@/lib/firebase/admin";
import { getMlTokenData } from "../../ml/token";
import {
  avaliarAds,
  avaliarCron,
  avaliarFirestoreRules,
  avaliarMercadoPago,
  avaliarNotificacoes,
  avaliarTokenML,
  statusGeral,
  type HealthSection,
} from "@/lib/domain/health";

export const maxDuration = 30;

/**
 * "Acesso > Saúde da operação" (Fase 1) — owner-only, nunca expõe segredo
 * (token, payload de push). Cada seção busca só o que dá pra calcular HOJE;
 * o que não é persistido em lugar nenhum (histórico de cron, coleta de Ads)
 * vem explicitamente como "sem-dados"/"não verificado" — ver
 * lib/domain/health.ts pra regra completa de cada status.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req, { adminOnly: true });
  if (gate instanceof NextResponse) return gate;

  const db = getAdminDb();

  // ── Token ML ──
  let secaoMl: HealthSection;
  try {
    const token = await getMlTokenData();
    const presente = !!(token?.access_token || token?.refresh_token);
    let expiraEmMin: number | null = null;
    if (token?.expires_in && token?.updated_at) {
      const updatedAt = Date.parse(token.updated_at);
      if (!Number.isNaN(updatedAt)) {
        const expiraEm = updatedAt + token.expires_in * 1000;
        expiraEmMin = Math.round((expiraEm - Date.now()) / 60000);
      }
    }

    // Pedido/devolução mais recente REGISTRADO (proxy honesto de atividade —
    // não sabemos se veio do cron ou do webhook, ver nota em health.ts).
    const [ultimoPedido, ultimaDevolucao] = await Promise.all([
      db.collection("ml_orders").orderBy("updatedAt", "desc").limit(1).get().catch(() => null),
      db.collection("ml_returns").orderBy("updatedAt", "desc").limit(1).get().catch(() => null),
    ]);

    secaoMl = avaliarTokenML({
      presente,
      expiraEmMin,
      ultimoRefresh: token?.updated_at ?? null,
      ultimoPedidoRegistrado: ultimoPedido?.docs[0]?.get("updatedAt") ?? null,
      ultimaDevolucaoRegistrada: ultimaDevolucao?.docs[0]?.get("updatedAt") ?? null,
    });
  } catch {
    secaoMl = avaliarTokenML({ presente: false, expiraEmMin: null, ultimoRefresh: null, ultimoPedidoRegistrado: null, ultimaDevolucaoRegistrada: null });
  }

  // ── Ads (nada persistido ainda) ──
  const secaoAds = avaliarAds();

  // ── Mercado Pago (repasse) ──
  let secaoMp: HealthSection;
  try {
    const JANELA_DIAS = 30;
    const desde = new Date(Date.now() - JANELA_DIAS * 86400000).toISOString();
    const snap = await db.collection("ml_orders").where("updatedAt", ">=", desde).get();
    let confirmados = 0, semRepasse = 0;
    for (const doc of snap.docs) {
      const net = Number(doc.get("net_received") ?? 0);
      if (net > 0) confirmados++; else semRepasse++;
    }
    secaoMp = avaliarMercadoPago({ confirmados, semRepasse, totalAmostra: snap.size, janelaDias: JANELA_DIAS });
  } catch {
    secaoMp = avaliarMercadoPago({ confirmados: 0, semRepasse: 0, totalAmostra: 0, janelaDias: 30 });
  }

  // ── Notificações ──
  let secaoNotif: HealthSection;
  try {
    const [tokensSnap, eventosSnap] = await Promise.all([
      db.collection("pushTokens").get(),
      db.collection("notification_events").orderBy("createdAt", "desc").limit(20).get(),
    ]);

    let ultimoEventoVenda: string | null = null;
    let ultimoPushTentado: string | null = null;
    let ultimoPushAceito: string | null = null;
    const errosRecentes: string[] = [];

    for (const doc of eventosSnap.docs) {
      const d = doc.data();
      const tipo = String(d.type ?? "");
      const createdAt = d.createdAt?.toDate?.()?.toISOString?.() ?? null;
      if (!ultimoEventoVenda && tipo.startsWith("sale_") && createdAt) ultimoEventoVenda = createdAt;

      const delivery = d.delivery ?? {};
      const attemptedAt = delivery.pushAttemptedAt?.toDate?.()?.toISOString?.() ?? null;
      const deliveredAt = delivery.pushDeliveredAt?.toDate?.()?.toISOString?.() ?? null;
      if (!ultimoPushTentado && attemptedAt) ultimoPushTentado = attemptedAt;
      if (!ultimoPushAceito && deliveredAt) ultimoPushAceito = deliveredAt;
      // pushError já é gravado sanitizado (≤200 chars, sem token) por
      // markPushError — ver lib/notification-events.ts. Ainda assim, corta
      // de novo aqui: esta tela é a última linha de defesa antes de expor
      // qualquer coisa pra UI.
      if (delivery.pushError && errosRecentes.length < 5) errosRecentes.push(String(delivery.pushError).slice(0, 160));
    }

    secaoNotif = avaliarNotificacoes({
      dispositivosAtivos: tokensSnap.size,
      ultimoEventoVenda,
      ultimoPushTentado,
      ultimoPushAceito,
      errosRecentes,
    });
  } catch {
    secaoNotif = avaliarNotificacoes({ dispositivosAtivos: 0, ultimoEventoVenda: null, ultimoPushTentado: null, ultimoPushAceito: null, errosRecentes: [] });
  }

  // ── Firestore / regras publicadas vs. repositório ──
  let secaoRules: HealthSection;
  try {
    let publicadoIgual: boolean | null = null;
    let publicadoEm: string | null = null;
    try {
      const ruleset = await getAdminSecurityRules().getFirestoreRuleset();
      publicadoEm = ruleset.createTime ?? null;
      const publicado = ruleset.source[0]?.content ?? "";
      const local = readFileSync(join(process.cwd(), "firestore.rules"), "utf-8");
      // Normaliza espaço em branco de borda/quebra de linha antes de comparar
      // — não queremos um falso "diferente" só por causa de CRLF vs LF.
      publicadoIgual = publicado.trim().replace(/\r\n/g, "\n") === local.trim().replace(/\r\n/g, "\n");
    } catch {
      // API de Security Rules pode não estar habilitada/permitida pra esta
      // service account — fica "não verificado", não um erro fatal da tela.
    }
    secaoRules = avaliarFirestoreRules({ conexaoOk: true, publicadoIgual, publicadoEm });
  } catch {
    secaoRules = avaliarFirestoreRules({ conexaoOk: false, publicadoIgual: null, publicadoEm: null });
  }

  // ── Cron (nada persistido ainda) ──
  const secaoCron = avaliarCron();

  const secoes = { ml: secaoMl, ads: secaoAds, mercadoPago: secaoMp, notificacoes: secaoNotif, firestore: secaoRules, cron: secaoCron };
  return NextResponse.json({
    geradoEm: new Date().toISOString(),
    statusGeral: statusGeral(Object.values(secoes)),
    secoes,
  });
}
