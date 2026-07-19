import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { desconectarML } from "@/lib/ml/tenant";

/**
 * Força a desconexão do ML DESTE usuário (limpa a conexão e marca o cookie).
 * Cada cliente só desconecta a própria conta — o uid vem do token verificado.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    await desconectarML(gate.uid);

    const response = NextResponse.json({ success: true });
    response.cookies.set("ml_session_cleared", "true", {
      maxAge: 60 * 60 * 24 * 30, // 30 dias
      path: "/",
    });
    return response;
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "force_logout_failed", details }, { status: 500 });
  }
}
