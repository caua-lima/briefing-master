"use client";

import { doc, getDoc } from "firebase/firestore";
import { getFirebase } from "./client";
import { normalizarPapel, type MembroTenant } from "@/lib/domain/tenant";

/**
 * Tenant do usuário logado, do lado do cliente.
 *
 * ─── POR QUE FICA EM CACHE DE MÓDULO ────────────────────────────────────
 *
 * `sCol`/`sDoc` em lib/firebase/data.ts são SÍNCRONOS e usados em 51 lugares.
 * Descobrir o tenant é uma leitura no Firestore — assíncrona. Transformar os
 * dois em async espalharia `await` por todas as 51 chamadas e por todos os
 * componentes que as usam, sem ganho nenhum: o tenant de um usuário não muda
 * no meio da sessão.
 *
 * Então o vínculo é carregado UMA vez, logo após o login (ver AccessGuard), e
 * daí em diante `getTenantIdAtual()` responde na hora. É o mesmo padrão que
 * `getCurrentUserEmail()` já usa com o auth.
 *
 * ─── POR QUE LANÇA EM VEZ DE DEVOLVER null ──────────────────────────────
 *
 * Sem tenant resolvido não existe caminho válido pra ler nem gravar. Devolver
 * null faria a chamada seguinte montar um caminho quebrado — ou pior, um
 * caminho de outro tenant, se alguém "consertasse" com um valor padrão. É
 * exatamente o tipo de fallback silencioso que o `|| "2420261535"` fazia no
 * servidor. Aqui, sem tenant, a operação para e aparece.
 */

let membroAtual: MembroTenant | null = null;
let uidCarregado: string | null = null;

/**
 * Lê o vínculo do usuário e guarda pra sessão. Chamar depois do login e antes
 * de qualquer leitura de dado. Idempotente por uid — trocar de conta recarrega.
 */
export async function carregarMembro(uid: string): Promise<MembroTenant | null> {
  if (uidCarregado === uid && membroAtual) return membroAtual;

  const { db } = getFirebase();
  const snap = await getDoc(doc(db, "tenant_membros", uid));
  if (!snap.exists()) {
    // Sem vínculo = ainda não passou pelo onboarding, ou acesso revogado.
    // Não é erro de programação; quem chama decide o que mostrar.
    membroAtual = null;
    uidCarregado = uid;
    return null;
  }

  const d = snap.data();
  membroAtual = {
    tenantId: String(d.tenantId ?? ""),
    email: String(d.email ?? ""),
    papel: normalizarPapel(d.papel),
    permissoesEdicao: Array.isArray(d.permissoesEdicao) ? d.permissoesEdicao : undefined,
    displayName: d.displayName,
    adicionadoEm: d.adicionadoEm,
    adicionadoPor: d.adicionadoPor,
  };
  uidCarregado = uid;
  return membroAtual;
}

/** Vínculo já carregado, ou null. Não dispara leitura. */
export function getMembroAtual(): MembroTenant | null {
  return membroAtual;
}

/** tenantId da sessão. LANÇA se ainda não resolveu — ver o comentário do topo. */
export function getTenantIdAtual(): string {
  const tid = membroAtual?.tenantId;
  if (!tid) {
    throw new Error(
      "tenant_nao_resolvido: nenhum tenant carregado para este usuário. " +
      "carregarMembro() precisa rodar depois do login e antes de ler ou gravar dados.",
    );
  }
  return tid;
}

/**
 * Esquece o tenant. Obrigatório no signOut: sem isso, entrar com outra conta
 * na mesma aba continuaria lendo e GRAVANDO no tenant do usuário anterior —
 * o pior tipo de vazamento, porque parece que funcionou.
 */
export function limparTenant(): void {
  membroAtual = null;
  uidCarregado = null;
}
