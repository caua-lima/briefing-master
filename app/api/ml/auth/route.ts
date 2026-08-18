import { NextResponse } from "next/server";
import { getAuthURL, generatePkce } from "@/lib/ml/client";
import { requireAccess } from "@/lib/api-auth";
import { criarOAuthState, resolverTenant } from "@/lib/tenant";

/**
 * Início do OAuth do Mercado Livre, por tenant.
 *
 * ─── MUDOU DE GET ABERTO PARA POST AUTENTICADO ──────────────────────────
 *
 * Antes era um GET sem autenticação nenhuma: qualquer um que abrisse a URL
 * era mandado pro ML, e o callback gravava o token no único lugar que
 * existia (ml_tokens/main). No single-tenant isso era no máximo estranho.
 * No multi-tenant é uma porta aberta — quem chamasse conseguiria enxertar
 * uma conta do Mercado Livre em algum tenant.
 *
 * Agora exige sessão válida, resolve o tenant de quem pediu, e só o OWNER
 * pode conectar: a conta do ML é da operação inteira, e trocá-la muda a
 * origem dos números de todo mundo do time.
 *
 * Devolve a URL em JSON em vez de redirecionar porque a chamada agora sai do
 * app autenticado (fetch com o token), não de um clique num link solto.
 */
export async function POST(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  const ctx = await resolverTenant(gate.uid, gate.email);
  if (!ctx) {
    return NextResponse.json(
      { error: "sem_tenant", details: "Nenhum tenant ativo para este usuário (sem vínculo ou licença vencida)." },
      { status: 403 },
    );
  }
  if (ctx.membro.papel !== "owner") {
    return NextResponse.json(
      { error: "somente_owner", details: "Só o owner conecta a conta do Mercado Livre da operação." },
      { status: 403 },
    );
  }

  const { verifier, challenge } = generatePkce();
  // O verifier vai pro Firestore junto do state, e NÃO num cookie: o callback
  // volta como navegação de terceiro (redirect do ML) e cookie SameSite=Lax
  // nem sempre acompanha. Guardando junto do state, os dois se encontram
  // sempre — e o verifier deixa de trafegar no navegador.
  const state = await criarOAuthState(ctx.tenantId, ctx.uid, verifier);

  return NextResponse.json({ url: getAuthURL(challenge, state) });
}
