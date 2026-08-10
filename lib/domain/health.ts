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

import type { DataFreshness } from "./freshness";

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

// ── Freshness → HealthStatus ─────────────────────────────────────
/** fresh/stale/partial/failed/unknown (lib/domain/freshness.ts) → saudavel/atencao/critico/sem-dados. */
function freshnessParaHealthStatus(status: DataFreshness["status"]): HealthStatus {
  switch (status) {
    case "fresh": return "saudavel";
    case "stale": return "atencao";
    case "partial": return "atencao";
    case "failed": return "critico";
    case "unknown": return "sem-dados";
  }
}

// ── Ads ──────────────────────────────────────────────────────────
/** Fase 4: app/api/ml/ads/route.ts agora grava tentativa/sucesso/falha em sync_runs — se `freshness` vier null (rota ainda não chamada), fica "sem-dados". */
export function avaliarAds(freshness: DataFreshness | null): HealthSection {
  if (!freshness) {
    return {
      titulo: "Ads",
      status: "sem-dados",
      itens: [{ label: "Última coleta", valor: "não verificado", status: "sem-dados", nota: "aba Ads ainda não foi aberta desde que o registro de freshness passou a existir" }],
    };
  }
  const status = freshnessParaHealthStatus(freshness.status);
  const itens: HealthItem[] = [
    { label: "Última coleta com sucesso", valor: fmtQuando(freshness.lastSuccessAt ?? null), status },
    { label: "Última tentativa", valor: fmtQuando(freshness.lastAttemptAt ?? null) },
  ];
  if (freshness.recordsProcessed != null) itens.push({ label: "Campanhas processadas na última coleta", valor: String(freshness.recordsProcessed) });
  if (freshness.coverage?.expected != null) {
    itens.push({ label: "Cobertura", valor: `${freshness.coverage.processed ?? 0}/${freshness.coverage.expected}`, status: freshness.status === "partial" ? "atencao" : undefined });
  }
  if (freshness.lastError) itens.push({ label: "Erro na última tentativa", valor: freshness.lastError, status: "critico" });
  return { titulo: "Ads", status, itens };
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
/**
 * Fase 4: cron/route.ts e sync-all/route.ts (botão manual, mesma fonte) agora
 * gravam tentativa/sucesso/falha em sync_runs pra "orders" e "claims" — o
 * status geral é o pior entre as duas, já que o cron sincroniza as duas
 * juntas numa única execução.
 */
export function avaliarCron(orders: DataFreshness | null, claims: DataFreshness | null): HealthSection {
  if (!orders && !claims) {
    return {
      titulo: "Sincronização automática (cron)",
      status: "sem-dados",
      itens: [{ label: "Última execução", valor: "não verificado", status: "sem-dados", nota: "nenhuma execução de cron ou sync manual registrada ainda desde que o registro de freshness passou a existir" }],
    };
  }
  const statusOrders = orders ? freshnessParaHealthStatus(orders.status) : "sem-dados";
  const statusClaims = claims ? freshnessParaHealthStatus(claims.status) : "sem-dados";
  const status = piorStatus([statusOrders, statusClaims]);
  const itens: HealthItem[] = [
    { label: "Pedidos — última sincronização com sucesso", valor: fmtQuando(orders?.lastSuccessAt ?? null), status: statusOrders },
    { label: "Pedidos — última tentativa", valor: fmtQuando(orders?.lastAttemptAt ?? null) },
    { label: "Devoluções/cancelamentos — última sincronização com sucesso", valor: fmtQuando(claims?.lastSuccessAt ?? null), status: statusClaims },
    { label: "Devoluções/cancelamentos — última tentativa", valor: fmtQuando(claims?.lastAttemptAt ?? null) },
  ];
  if (orders?.recordsProcessed != null) itens.push({ label: "Pedidos atualizados na última execução", valor: String(orders.recordsProcessed) });
  if (claims?.recordsProcessed != null) itens.push({ label: "Devoluções/cancelamentos atualizados na última execução", valor: String(claims.recordsProcessed) });
  if (orders?.lastError) itens.push({ label: "Erro na última tentativa (pedidos)", valor: orders.lastError, status: "critico" });
  if (claims?.lastError) itens.push({ label: "Erro na última tentativa (devoluções)", valor: claims.lastError, status: "critico" });
  return { titulo: "Sincronização automática (cron)", status, itens };
}

export function statusGeral(secoes: HealthSection[]): HealthStatus {
  return piorStatus(secoes.map((s) => s.status));
}
