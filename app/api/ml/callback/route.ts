import { NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/ml/client";
import { consumirOAuthState, salvarConexao } from "@/lib/tenant";

/**
 * Retorno do OAuth do Mercado Livre.
 *
 * ─── COMO ELE SABE DE QUEM É A CONTA ────────────────────────────────────
 *
 * Esta rota NÃO tem sessão: é o Mercado Livre redirecionando o navegador de
 * volta, não o app chamando. Então a identidade tem que vir de algo que
 * atravessou o redirect — o `state`.
 *
 * O state é uma chave opaca criada em /api/ml/auth, guardada no servidor
 * junto de tenantId, uid e o verifier do PKCE. Aqui ele é lido e QUEIMADO
 * (uso único). Nada de tenant vem da URL nem de cookie: se viesse, bastaria
 * adulterar o valor pra gravar a conta do Mercado Livre de alguém dentro do
 * tenant de outro cliente.
 *
 * State ausente, já usado, expirado ou desconhecido = recusa. Nunca escolhe
 * um tenant padrão — era esse tipo de fallback silencioso que fazia a versão
 * single-tenant gravar tudo em ml_tokens/main.
 */
function erro(req: Request, motivo: string) {
  // Volta pro app com o motivo na URL: a tela de conexão mostra a mensagem.
  // Não devolve JSON porque quem está aqui é um navegador, no meio de um
  // fluxo de login — JSON cru seria um beco sem saída pro usuário.
  const url = new URL("/", req.url);
  url.searchParams.set("ml_erro", motivo);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code) return erro(req, "sem_code");
    if (!state) return erro(req, "sem_state");

    const registro = await consumirOAuthState(state);
    if (!registro) return erro(req, "state_invalido");

    const token = await exchangeCodeForToken(code, registro.verifier);

    // salvarConexao já busca /users/me e persiste o seller_id — é ele que o
    // webhook usa depois pra descobrir de qual tenant é o pedido que chegou.
    const { sellerId, nickname } = await salvarConexao(registro.tenantId, registro.uid, {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
    });

    if (!sellerId) {
      // Sem seller_id o webhook não consegue rotear a venda pro tenant certo.
      // Conexão pela metade é pior que nenhuma: parece conectada e some com
      // as vendas. Melhor dizer agora.
      return erro(req, "sem_seller_id");
    }

    const ok = new URL("/", req.url);
    ok.searchParams.set("ml_conectado", nickname || sellerId);
    return NextResponse.redirect(ok);
  } catch (e: unknown) {
    console.error("[ml/callback] falhou", e);
    return erro(req, "falha_na_troca");
  }
}
