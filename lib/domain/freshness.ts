// ── Freshness por fonte de dado (Fase 4) ─────────────────────────
// Puro de propósito — interpreta timestamps já buscados e decide o status.
// A leitura/escrita real no Firestore fica em lib/sync-runs.ts (server-only).

export type DataFreshnessSource = "orders" | "claims" | "mercado_pago" | "ads" | "full_stock";
export type DataFreshnessStatus = "fresh" | "stale" | "partial" | "failed" | "unknown";

export type DataFreshness = {
  source: DataFreshnessSource;
  status: DataFreshnessStatus;
  lastSuccessAt?: string; // ISO
  lastAttemptAt?: string; // ISO
  lastError?: string; // já sanitizado (sem token/payload) por quem grava — ver lib/sync-runs.ts
  recordsProcessed?: number;
  coverage?: { expected?: number; processed?: number };
};

export const SOURCE_LABEL: Record<DataFreshnessSource, string> = {
  orders: "Pedidos",
  claims: "Devoluções/cancelamentos",
  mercado_pago: "Repasse Mercado Pago",
  ads: "Ads",
  full_stock: "Estoque Full",
};

/**
 * Decide o status a partir de quando foi a última tentativa/sucesso —
 * "stale" (desatualizado, mas com dado bom) é diferente de "failed"
 * (a ÚLTIMA tentativa falhou) e de "unknown" (nunca rodou nenhuma vez).
 * Regra inegociável: uma falha nunca vira "não temos dado nenhum" quando
 * já existe um sucesso anterior — o dado velho continua sendo o melhor que
 * temos, só marcado como desatualizado.
 */
export function computeFreshnessStatus(input: {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptFailed: boolean;
  staleAfterMinutes: number;
  parcial?: boolean; // coverage.processed < coverage.expected no último sucesso
}): DataFreshnessStatus {
  if (!input.lastSuccessAt && !input.lastAttemptAt) return "unknown";
  if (!input.lastSuccessAt) return "failed"; // só tentativas, nenhuma nunca deu certo
  if (input.lastAttemptFailed) return "failed"; // teve sucesso antes, mas a ÚLTIMA tentativa falhou
  if (input.parcial) return "partial";

  const idadeMin = (Date.now() - Date.parse(input.lastSuccessAt)) / 60000;
  return idadeMin > input.staleAfterMinutes ? "stale" : "fresh";
}

export function buildFreshness(
  source: DataFreshnessSource,
  raw: {
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastAttemptFailed: boolean;
    lastError: string | null;
    recordsProcessed: number | null;
    coverage: { expected?: number; processed?: number } | null;
    staleAfterMinutes: number;
  },
): DataFreshness {
  const parcial = raw.coverage?.expected != null && raw.coverage?.processed != null && raw.coverage.processed < raw.coverage.expected;
  return {
    source,
    status: computeFreshnessStatus({
      lastSuccessAt: raw.lastSuccessAt,
      lastAttemptAt: raw.lastAttemptAt,
      lastAttemptFailed: raw.lastAttemptFailed,
      staleAfterMinutes: raw.staleAfterMinutes,
      parcial,
    }),
    lastSuccessAt: raw.lastSuccessAt ?? undefined,
    lastAttemptAt: raw.lastAttemptAt ?? undefined,
    lastError: raw.lastAttemptFailed ? (raw.lastError ?? undefined) : undefined,
    recordsProcessed: raw.recordsProcessed ?? undefined,
    coverage: raw.coverage ?? undefined,
  };
}

/**
 * Sanitiza uma mensagem de erro antes de persistir — nunca token, nunca
 * payload completo de resposta de API. Corta em 200 chars (mesmo limite já
 * usado em lib/notification-events.ts pra erro de push) e remove qualquer
 * substring que pareça um Bearer token colado por engano na mensagem.
 */
export function sanitizeErrorForStorage(raw: string): string {
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/access_token["=:]\s*[A-Za-z0-9._-]+/gi, "access_token=[REDACTED]")
    .slice(0, 200);
}
