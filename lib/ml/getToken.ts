import { getValidMlAccessToken as tokenDoUsuario } from "@/lib/ml/tenant";

/**
 * Access token válido do Mercado Livre DO USUÁRIO informado, renovando pelo
 * refresh_token quando necessário.
 *
 * No SaaS não existe "o token" — existe o token de cada cliente. Por isso o uid
 * é obrigatório: quem chama precisa dizer de quem é a conta. O uid vem do
 * requireAccess(req) das rotas (token do Firebase já verificado).
 */
export async function getValidMlAccessToken(uid: string): Promise<string> {
  return tokenDoUsuario(uid);
}
