"use client";

import { authedFetch } from "@/lib/api/authed-fetch";

/**
 * Inicia a conexão com o Mercado Livre.
 *
 * A rota /api/ml/auth deixou de ser um GET aberto (bastava abrir a URL) e
 * virou POST autenticado: no multi-tenant é preciso saber QUEM está
 * conectando e para qual tenant, e só o owner pode. Por isso não dá mais pra
 * apontar um <a href> pra ela — a chamada precisa levar o token da sessão.
 *
 * Fica num helper porque três componentes fazem isso (MLConnectButton,
 * MlAccountStatus, MlConnect); três cópias divergiriam na primeira mudança.
 *
 * Devolve a mensagem de erro em vez de lançar: quem chama já tem onde mostrar
 * feedback, e um throw aqui viraria erro não tratado no meio de um clique.
 */
export async function iniciarConexaoML(): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const res = await authedFetch("/api/ml/auth", { method: "POST" });
    const corpo = await res.json().catch(() => null) as { url?: string; error?: string; details?: string } | null;

    if (!res.ok) {
      // Mensagens específicas pros dois casos que o usuário consegue resolver.
      if (corpo?.error === "somente_owner") {
        return { ok: false, erro: "Só o owner da operação pode conectar a conta do Mercado Livre." };
      }
      if (corpo?.error === "sem_tenant") {
        return { ok: false, erro: "Sua conta ainda não está vinculada a uma operação, ou a licença venceu." };
      }
      return { ok: false, erro: corpo?.details || `Falha ao iniciar a conexão (HTTP ${res.status}).` };
    }

    if (!corpo?.url) return { ok: false, erro: "O servidor não devolveu a URL de autorização." };

    window.location.href = corpo.url;
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}
