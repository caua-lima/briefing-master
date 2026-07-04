import { getMlAccessToken } from "@/app/api/ml/token";

/**
 * Retorna um access token válido do Mercado Livre, renovando via refresh_token
 * quando necessário. Delega para o gerenciador canônico em app/api/ml/token.ts
 * (fonte única de verdade — evita formatos de `updated_at` divergentes).
 */
export async function getValidMlAccessToken(): Promise<string> {
  const token = await getMlAccessToken();
  if (!token) {
    throw new Error("Token ML não encontrado ou expirado. Reconecte o Mercado Livre.");
  }
  return token;
}
