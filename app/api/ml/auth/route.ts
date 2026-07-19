import { NextResponse } from "next/server";
import { getAuthURL, generatePkce } from "@/lib/ml/client";
import { requireAccess } from "@/lib/api-auth";
import { criarOAuthState } from "@/lib/ml/tenant";

/**
 * Início do OAuth do Mercado Livre — AUTENTICADO.
 *
 * No SaaS cada cliente conecta a própria conta ML, então precisamos saber QUEM
 * está conectando. O callback do ML chega sem sessão (é um redirect do ML pro
 * navegador), por isso guardamos uid + code_verifier no servidor e mandamos só
 * um `state` opaco na URL — nada sensível trafega e o uid não é falsificável.
 *
 * O cliente chama isto com o token do Firebase e recebe a URL para redirecionar.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const { verifier, challenge } = generatePkce();
  const state = await criarOAuthState(gate.uid, verifier);

  return NextResponse.json({ url: getAuthURL(challenge, state) });
}
