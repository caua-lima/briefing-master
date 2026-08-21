import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";

export const maxDuration = 30;

/**
 * Diagnóstico da cadeia de notificação de venda.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────
 *
 * "Não chega notificação" tem pelo menos cinco causas possíveis, e elas pedem
 * correções OPOSTAS:
 *
 *   1. O Mercado Livre nunca chama a nossa URL (webhook não cadastrado no
 *      painel de Developers, tópico `orders_v2` não assinado, URL de um
 *      deploy antigo). → nada no código resolve; é configuração no ML.
 *   2. O ML chama e nós quebramos (token, Firestore, erro no cálculo).
 *   3. O evento é criado mas nenhum aparelho está registrado.
 *   4. Está registrado, mas a preferência do usuário ou o horário silencioso
 *      bloqueiam.
 *   5. O push sai e o aparelho não exibe (permissão revogada, token morto).
 *
 * Sem medir, qualquer conserto é chute. Esta rota responde as cinco de uma
 * vez, com o que o sistema REGISTROU — não com suposição.
 *
 * Só metadado: nunca token, nunca corpo de requisição.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const db = getAdminDb();
  const agora = Date.now();
  const h24 = agora - 24 * 3600 * 1000;

  // ── 1/2. O ML está batendo aqui? ──
  let chamadas: Record<string, unknown>[] = [];
  let webhookIndisponivel = false;
  try {
    const snap = await db.collection("webhook_log").orderBy("ts", "desc").limit(30).get();
    chamadas = snap.docs.map((d) => d.data());
  } catch {
    // Índice ausente ou coleção nova: não é erro do diagnóstico.
    webhookIndisponivel = true;
  }
  const ultimas24h = chamadas.filter((c) => Number(c.ts ?? 0) >= h24);
  const comErro = ultimas24h.filter((c) => c.ok === false);

  // ── 3. Existe aparelho registrado? ──
  const tokensSnap = await db.collection("pushTokens").get();
  const porEmail = new Map<string, number>();
  for (const d of tokensSnap.docs) {
    const email = String(d.data()?.email ?? "(sem e-mail)");
    porEmail.set(email, (porEmail.get(email) ?? 0) + 1);
  }

  // ── 4/5. Os eventos recentes conseguiram entregar? ──
  let eventos: Record<string, unknown>[] = [];
  try {
    const snap = await db.collection("notification_events").orderBy("createdAt", "desc").limit(20).get();
    eventos = snap.docs.map((d) => {
      const v = d.data();
      const entrega = (v.delivery ?? {}) as Record<string, unknown>;
      return {
        id: d.id,
        type: v.type,
        title: v.title,
        // O que interessa aqui é a ENTREGA, não o conteúdo.
        tentou: Boolean(entrega.pushAttemptedAt),
        entregou: Boolean(entrega.pushDeliveredAt),
        erro: entrega.pushError ?? null,
      };
    });
  } catch { /* idem */ }

  const vendasRecentes = eventos.filter((e) => String(e.type ?? "").startsWith("sale_"));
  const semEntrega = vendasRecentes.filter((e) => e.tentou && !e.entregou);

  /**
   * Veredito em texto: a leitura correta de cada combinação, pra quem abre
   * isto não precisar interpretar os números sozinho.
   */
  const diagnostico: string[] = [];
  if (webhookIndisponivel || chamadas.length === 0) {
    diagnostico.push(
      "O Mercado Livre NUNCA chamou este servidor (nenhum registro de webhook). "
      + "Isso é configuração no ML, não código: em Developers › sua aplicação › Notificações, "
      + "confirme a URL de callback apontando pra /api/ml/webhook DESTE domínio e o tópico "
      + "'orders_v2' marcado. Enquanto isso, o sync a cada 15 min é quem manda os avisos.",
    );
  } else if (ultimas24h.length === 0) {
    diagnostico.push("O ML já chamou este servidor antes, mas nada nas últimas 24h. Se houve venda nesse período, a notificação do ML pode ter sido desativada.");
  }
  if (comErro.length > 0) {
    diagnostico.push(`${comErro.length} chamada(s) do ML falharam nas últimas 24h — ver 'erro' em ultimasChamadas.`);
  }
  if (tokensSnap.size === 0) {
    diagnostico.push("NENHUM aparelho registrado para push. Abra o app no celular e ative as notificações — sem isso não há para onde enviar.");
  }
  if (semEntrega.length > 0) {
    diagnostico.push(
      `${semEntrega.length} evento(s) de venda tentaram enviar e não entregaram. `
      + "Veja o campo 'erro' — 'bloquearam por preferência' é configuração de notificação; "
      + "'nenhum dispositivo registrado' é token faltando.",
    );
  }
  if (diagnostico.length === 0) {
    diagnostico.push("Cadeia saudável: o ML está chamando, há aparelho registrado e os eventos recentes entregaram.");
  }

  return NextResponse.json({
    diagnostico,
    webhook: {
      chamadasRegistradas: chamadas.length,
      ultimas24h: ultimas24h.length,
      comErro: comErro.length,
      ultimaChamadaEm: chamadas[0]?.at ?? null,
      ultimasChamadas: chamadas.slice(0, 10),
    },
    dispositivos: {
      total: tokensSnap.size,
      porEmail: Object.fromEntries(porEmail),
    },
    eventos: {
      recentes: eventos.length,
      vendas: vendasRecentes.length,
      semEntrega: semEntrega.length,
      ultimos: eventos.slice(0, 10),
    },
  });
}
