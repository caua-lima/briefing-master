/**
 * Criação de conta de cliente do SaaS — a parte pura.
 *
 * ─── O MODELO É "EU CRIO A CONTA", NÃO SELF-SERVICE ─────────────────────
 *
 * O dono do negócio vende por contato direto e cria a conta do cliente ele
 * mesmo; o cliente só entra e conecta o Mercado Livre dele. Isso não é uma
 * limitação temporária — é o desenho. Muda uma coisa importante em relação a
 * um cadastro aberto: quem escolhe o `tenantId` é o admin, não o visitante, e
 * por isso a validação aqui pode ser rígida sem custo de conversão.
 *
 * Rígida importa porque o `tenantId` vira PARTE DO CAMINHO de toda coleção
 * (`tenants/{tenantId}/estoque`, …) e de toda regra do Firestore. Um id com
 * espaço, acento ou barra não falha na hora: falha depois, em algum lugar
 * difícil de ligar à causa.
 *
 * ─── AS TRÊS PEÇAS DE UMA CONTA ─────────────────────────────────────────
 *
 * Separadas de propósito (ver lib/domain/tenant.ts): juntar comercial com
 * operacional foi exatamente a colisão que o modelo antigo tinha, onde
 * `role == "owner"` queria dizer "dono da loja" E "dono do SaaS".
 *
 *   tenants/{tenantId}     → a operação
 *   tenant_membros/{uid}   → quem opera, com que papel
 *   licencas/{email}       → pagou? está no prazo?
 *
 * Puro de propósito: nada de Firestore aqui. O I/O fica no script/rota que
 * chama, e a validação pode ser testada sem subir nada.
 */

/** Só minúsculas, números e hífen. É caminho de coleção e de regra. */
const RE_TENANT_ID = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Ids que quebrariam ou confundiriam o roteamento se virassem tenant.
 * `main` merece nota: era o id do doc único no modelo single-tenant
 * (`ml_tokens/main`), e reaproveitá-lo aqui tornaria qualquer investigação
 * futura ambígua.
 */
const RESERVADOS = new Set(["main", "admin", "api", "app", "www", "sistema", "teste", "null", "undefined"]);

/**
 * Transforma um nome de empresa num id utilizável. Acento vira letra simples,
 * o resto vira hífen — o cliente escreve "Loja do João", o id sai
 * "loja-do-joao" e nada quebra três telas adiante.
 */
export function normalizarTenantId(nome: string): string {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tira acento, mantém a letra
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, ""); // o corte em 40 pode ter deixado hífen na ponta
}

export type NovoCliente = {
  tenantId: string;
  /** Nome de exibição da operação. */
  nome: string;
  /** E-mail do dono — é a chave da licença e do login. */
  email: string;
  /** Dias de validade da licença. 0 ou ausente = sem prazo. */
  diasLicenca?: number;
};

export type Validacao = { ok: true } | { ok: false; erros: string[] };

export function validarNovoCliente(c: Partial<NovoCliente>): Validacao {
  const erros: string[] = [];
  const tenantId = String(c.tenantId ?? "").trim();
  const email = String(c.email ?? "").trim().toLowerCase();
  const nome = String(c.nome ?? "").trim();

  if (!tenantId) {
    erros.push("Informe o identificador da conta (tenantId).");
  } else if (!RE_TENANT_ID.test(tenantId)) {
    erros.push(
      `Identificador inválido: "${tenantId}". Use só minúsculas, números e hífen, ` +
      "começando por letra (ex.: loja-do-joao). Ele vira parte do caminho de todos os dados.",
    );
  } else if (RESERVADOS.has(tenantId)) {
    erros.push(`"${tenantId}" é reservado pelo sistema — escolha outro identificador.`);
  }

  if (!nome) erros.push("Informe o nome da operação (aparece no painel do cliente).");

  if (!email) erros.push("Informe o e-mail do dono.");
  else if (!RE_EMAIL.test(email)) erros.push(`E-mail inválido: "${email}".`);

  const dias = Number(c.diasLicenca ?? 0);
  if (!Number.isFinite(dias) || dias < 0) {
    erros.push("Dias de licença precisa ser um número maior ou igual a zero (0 = sem prazo).");
  }

  return erros.length ? { ok: false, erros } : { ok: true };
}

export type DocsCliente = {
  tenant: { id: string; nome: string; criadoEm: number; criadoPor: string };
  licenca: { email: string; status: "ativo"; expiresAt: number | null; nota: string; criadaEm: number };
  membro: { tenantId: string; email: string; papel: "owner"; adicionadoEm: number; adicionadoPor: string };
};

/**
 * Monta os três documentos de uma conta nova.
 *
 * `agora` entra por parâmetro pra o resultado ser determinístico no teste —
 * data gerada dentro da função tornaria a saída impossível de comparar.
 */
export function montarDocsCliente(c: NovoCliente, criadoPor: string, agora = Date.now()): DocsCliente {
  const email = c.email.trim().toLowerCase();
  const dias = Number(c.diasLicenca ?? 0);
  return {
    tenant: {
      id: c.tenantId,
      nome: c.nome.trim(),
      criadoEm: agora,
      criadoPor,
    },
    licenca: {
      email,
      status: "ativo",
      // null = sem prazo. Diferente de 0, que seria "vencida em 1970".
      expiresAt: dias > 0 ? agora + dias * 86400000 : null,
      nota: dias > 0 ? `licença de ${dias} dia(s), criada no onboarding` : "sem prazo, criada no onboarding",
      criadaEm: agora,
    },
    membro: {
      tenantId: c.tenantId,
      email,
      papel: "owner",
      adicionadoEm: agora,
      adicionadoPor: criadoPor,
    },
  };
}

/**
 * Senha inicial descartável. O cliente troca no primeiro acesso — e é por
 * isso que ela precisa ser aleatória e não derivada do e-mail ou do nome: uma
 * senha previsível numa conta que ainda não foi acessada é conta aberta.
 */
export function senhaInicial(aleatorio: () => number = Math.random): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 14; i++) s += alfabeto[Math.floor(aleatorio() * alfabeto.length)];
  return s;
}
