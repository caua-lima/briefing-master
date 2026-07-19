import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { desconectarML } from "@/lib/ml/tenant";

/**
 * Desconecta a conta do Mercado Livre DESTE usuário. Não exige owner: no SaaS
 * cada cliente administra a própria conexão (e só a dele — o uid vem do token).
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    await desconectarML(gate.uid);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "disconnect_failed", details }, { status: 500 });
  }
}
