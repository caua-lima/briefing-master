import { NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/ml/client";
import { consumirOAuthState, salvarConexao } from "@/lib/ml/tenant";

/**
 * Retorno do OAuth do Mercado Livre.
 *
 * Chega SEM sessão (é o ML redirecionando o navegador), então descobrimos de
 * quem é a conexão pelo `state` — que aponta para o uid e o code_verifier
 * guardados no servidor quando o usuário iniciou o fluxo. O state é de uso
 * único e expira em 10 min.
 */
function erro(req: Request, motivo: string) {
  const url = new URL("/", req.url);
  url.searchParams.set("ml_erro", motivo);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";

    if (!code) return erro(req, "sem_code");

    const sessao = await consumirOAuthState(state);
    if (!sessao) {
      // state ausente/expirado/reusado — refazer a conexão do começo
      return erro(req, "sessao_expirada");
    }

    const token = await exchangeCodeForToken(code, sessao.verifier);
    if (!token?.access_token) return erro(req, "sem_token");

    // Guarda a conexão NO USUÁRIO que iniciou o fluxo e resolve qual conta ML é
    await salvarConexao(sessao.uid, {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
    });

    const ok = new URL("/", req.url);
    ok.searchParams.set("ml_conectado", "1");
    return NextResponse.redirect(ok);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return erro(req, `falha:${msg.slice(0, 80)}`);
  }
}
