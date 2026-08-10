// ── Saúde da operação (Fase 1) ──────────────────────────────────
// Puro de propósito (sem Firestore/rede) — a rota que busca o dado real fica
// em app/api/admin/health/route.ts, este arquivo só interpreta o que já foi
// buscado e decide o status (saudável/atenção/crítico/sem-dados). Assim dá
// pra testar a INTERPRETAÇÃO sem precisar de credencial de Firebase/ML real.
//
// Regra da missão: nunca inventar um health check que não dá pra calcular —
// quando não há evidência (ver comentário em cada seção da rota sobre o que
// AINDA não é persistido, ex.: histórico de execução do cron), o status vira
// "sem-dados" e o item mostra "não verificado", não um chute otimista.

export type HealthStatus = "saudavel" | "atencao" | "critico" | "sem-dados";

export type HealthItem = {
  label: string;
  valor: string;
  status?: HealthStatus;
  nota?: string;
};

export type HealthSection = {
  titulo: string;
  status: HealthStatus;
  itens: HealthItem[];
};

/** Pior status entre uma lista — "crítico" pesa mais que "atenção", que pesa mais que "sem-dados", que pesa mais que "saudável". */
function piorStatus(statuses: HealthStatus[]): HealthStatus {
  const peso: Record<HealthStatus, number> = { critico: 3, atencao: 2, "sem-dados": 1, saudavel: 0 };
  return statuses.reduce((pior, s) => (peso[s] > peso[pior] ? s : pior), "saudavel" as HealthStatus);
}

function fmtQuando(iso: string | null): string {
  if (!iso) return "nunca registrado";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "data inválida";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Integração ML (token) ───────────────────────────────────────
export function avaliarTokenML(input: {
  presente: boolean;
  expiraEmMin: number | null; // null = sem expires_in/updated_at pra calcular
  ultimoRefresh: string | null;
  ultimoPedidoRegistrado: string | null;
  ultimaDevolucaoRegistrada: string | null;
}): HealthSection {
  const itens: HealthItem[] = [];
  let statusToken: HealthStatus;

  if (!input.presente) {
    statusToken = "critico";
    itens.push({ label: "Token de acesso", valor: "ausente", status: "critico", nota: "Reconecte a conta ML." });
  } else if (input.expiraEmMin == null) {
    statusToken = "sem-dados";
    itens.push({ label: "Token de acesso", valor: "presente", status: "sem-dados", nota: "não verificado (sem expires_in/updated_at gravado)" });
  } else if (input.expiraEmMin <= 0) {
    statusToken = "critico";
    itens.push({ label: "Token de acesso", valor: "expirado", status: "critico" });
  } else if (input.expiraEmMin <= 60) {
    statusToken = "atencao";
    itens.push({ label: "Token de acesso", valor: `expira em ${input.expiraEmMin} min`, status: "atencao" });
  } else {
    statusToken = "saudavel";
    itens.push({ label: "Token de acesso", valor: "válido", status: "saudavel" });
  }

  itens.push({ label: "Último refresh do token", valor: fmtQuando(input.ultimoRefresh) });
  itens.push({
    label: "Pedido mais recente registrado",
    valor: fmtQuando(input.ultimoPedidoRegistrado),
    nota: "proxy de atividade — não distingue se veio do cron ou do webhook, isso ainda não é registrado separadamente (Fase 4)",
  });
  itens.push({ label: "Devolução/cancelamento mais recente registrado", valor: fmtQuando(input.ultimaDevolucaoRegistrada) });
  itens.push({ label: "Última coleta de estoque Full", valor: "não verificado", status: "sem-dados", nota: "estoque-ml é buscado ao vivo a cada abertura da aba, sem timestamp persistido ainda" });
  itens.push({ label: "Status do webhook", valor: "não verificado", status: "sem-dados", nota: "não há registro de recebimento de webhook separado do registro de pedido — ver Fase 4" });

  return { titulo: "Integração Mercado Livre", status: statusToken, itens };
}

// ── Ads ──────────────────────────────────────────────────────────
/** Hoje NADA aqui é persistido — a aba Ads busca tudo ao vivo, sem gravar histórico de coleta. Seção inteira "sem-dados" até a Fase 3/4 existirem de verdade. */
export function avaliarAds(): HealthSection {
  return {
    titulo: "Ads",
    status: "sem-dados",
    itens: [
      { label: "Última coleta", valor: "não verificado", status: "sem-dados", nota: "aba Ads busca ao vivo a cada abertura, sem persistir histórico" },
      { label: "Status da última coleta", valor: "não verificado", status: "sem-dados" },
      { label: "Campanhas processadas", valor: "não verificado", status: "sem-dados" },
    ],
  };
}

// ── Mercado Pago (repasse) ──────────────────────────────────────
export function avaliarMercadoPago(input: { confirmados: number; semRepasse: number; totalAmostra: number; janelaDias: number }): HealthSection {
  const status: HealthStatus = input.totalAmostra === 0 ? "sem-dados" : input.semRepasse > input.confirmados ? "atencao" : "saudavel";
  return {
    titulo: "Repasse Mercado Pago",
    status,
    itens: [
      { label: `Pedidos com repasse confirmado (últimos ${input.janelaDias}d)`, valor: String(input.confirmados) },
      { label: `Pedidos sem repasse disponível ainda (últimos ${input.janelaDias}d)`, valor: String(input.semRepasse), nota: "normal pra pedido recente — repasse do MP demora alguns dias" },
      { label: "Amostra total", valor: String(input.totalAmostra) },
    ],
  };
}

// ── Notificações ─────────────────────────────────────────────────
export function avaliarNotificacoes(input: {
  dispositivosAtivos: number;
  ultimoEventoVenda: string | null;
  ultimoPushTentado: string | null;
  ultimoPushAceito: string | null;
  errosRecentes: string[]; // já sanitizados por quem chama (sem token/payload)
}): HealthSection {
  const semDispositivo = input.dispositivosAtivos === 0;
  const status: HealthStatus = semDispositivo ? "atencao" : input.errosRecentes.length > 0 ? "atencao" : "saudavel";
  const itens: HealthItem[] = [
    { label: "Dispositivos ativos", valor: String(input.dispositivosAtivos), status: semDispositivo ? "atencao" : "saudavel" },
    { label: "Último evento de venda", valor: fmtQuando(input.ultimoEventoVenda) },
    { label: "Último push tentado", valor: fmtQuando(input.ultimoPushTentado) },
    { label: "Último push aceito pelo FCM", valor: fmtQuando(input.ultimoPushAceito) },
  ];
  if (input.errosRecentes.length > 0) {
    itens.push({ label: "Erros recentes de entrega", valor: `${input.errosRecentes.length} nos últimos eventos`, status: "atencao", nota: input.errosRecentes.slice(0, 3).join(" · ") });
  }
  return { titulo: "Notificações", status, itens };
}

// ── Firestore / regras ───────────────────────────────────────────
export function avaliarFirestoreRules(input: {
  conexaoOk: boolean;
  publicadoIgual: boolean | null; // null = não deu pra comparar (ex.: sem permissão da API de rules)
  publicadoEm: string | null;
}): HealthSection {
  if (!input.conexaoOk) {
    return { titulo: "Firestore", status: "critico", itens: [{ label: "Conexão", valor: "falhou", status: "critico" }] };
  }
  const itens: HealthItem[] = [{ label: "Conexão", valor: "OK", status: "saudavel" }];
  let status: HealthStatus;
  if (input.publicadoIgual === null) {
    status = "sem-dados";
    itens.push({ label: "Regras publicadas == repositório local", valor: "não verificado", status: "sem-dados" });
  } else if (input.publicadoIgual) {
    status = "saudavel";
    itens.push({ label: "Regras publicadas == repositório local", valor: "sim", status: "saudavel" });
  } else {
    status = "critico";
    itens.push({
      label: "Regras publicadas == repositório local",
      valor: "NÃO — diferem",
      status: "critico",
      nota: "Regras do Firestore exigem deploy separado do app (firebase deploy --only firestore:rules). Ver docs/FIRESTORE_RULES_DEPLOY.md.",
    });
  }
  itens.push({ label: "Última publicação de regras", valor: fmtQuando(input.publicadoEm) });
  return { titulo: "Firestore", status, itens };
}

// ── Cron ─────────────────────────────────────────────────────────
/** Nenhuma execução de cron é persistida hoje (achado A3/A4 da auditoria) — seção inteira "sem-dados" até a Fase 4 existir. */
export function avaliarCron(): HealthSection {
  return {
    titulo: "Sincronização automática (cron)",
    status: "sem-dados",
    itens: [
      { label: "Última execução", valor: "não verificado", status: "sem-dados", nota: "cron/route.ts calcula o resultado mas nunca grava — ver Fase 4 (DataFreshness)" },
      { label: "Duração", valor: "não verificado", status: "sem-dados" },
      { label: "Pedidos/devoluções atualizados na última execução", valor: "não verificado", status: "sem-dados" },
    ],
  };
}

export function statusGeral(secoes: HealthSection[]): HealthStatus {
  return piorStatus(secoes.map((s) => s.status));
}
