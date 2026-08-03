import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { sendPushToUser } from "@/lib/push-send";

/**
 * Dispara uma notificação de teste só pros dispositivos do usuário logado —
 * é o botão "Enviar teste" no sino da barra superior. Existe porque o status
 * "ativo/inativo" ali é local (permissão do navegador + uma flag salva), e
 * isso não prova que o pipeline inteiro funciona (token salvo no Firestore →
 * FCM aceita → o aparelho de fato mostra o aviso). Um teste real fecha essa
 * dúvida sem esperar a próxima venda.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const { enviados } = await sendPushToUser(
      gate.email,
      "🔔 Notificação de teste",
      "Se você viu isso, as notificações estão funcionando neste aparelho.",
    );
    return NextResponse.json({ ok: true, enviados });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
