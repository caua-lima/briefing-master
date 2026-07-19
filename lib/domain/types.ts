export type Listing = {
  name: string;
  preco: string;
  retorno: string;
  custo: string;
  vendas: string;
  ads: string;
  mlb?: string;
  productId?: string;
};

export type ComputedAd = {
  name: string;
  faturamento: number;
  cmv: number;
  bruto: number;
  liquido: number;
  margem: number;
  ads: number;
  roas: number | null;
};

export type DaySummary = {
  ads: ComputedAd[];
  totalFaturamento: number;
  totalCMV: number;
  totalBruto: number;
  totalLiquido: number;
  totalAds: number;
  totalRoas: number | null;
  totalMargem: number;
};

export type ArchivedDay = DaySummary & {
  date: string;
  raw: Listing[];
  createdBy?: string;
};

export type Goals = {
  mes: string;
  meta1: number;
  meta2: number | null;
  meta3: number | null;
  // Meta de margem de lucro líquido em % (padrão 10). A meta diária é derivada
  // automaticamente da meta mensal (meta1 / dias do mês).
  metaMargem: number | null;
  metaDiaria: number | null;
  meta2Diaria: number | null;
  meta3Diaria: number | null;
  label?: string;
};

export type GoalEntry = {
  id: string;
  mes: string;
  meta1: number;
  meta2: number | null;
  meta3: number | null;
  metaMargem: number | null;
  metaDiaria: number | null;
  meta2Diaria: number | null;
  meta3Diaria: number | null;
  label?: string;
  createdBy?: string;
  createdAt?: number;
};

export type Cost = {
  id: string;
  nome: string;
  valor: string;
  freq: "diario" | "mensal" | "avulso";
  data: string;
  createdBy?: string;
};

export type DraftToday = {
  date: string;
  ads: Listing[];
  createdBy?: string;
  updatedAt?: number;
};

export type Product = {
  id: string;
  name: string;
  custo: string;             // custo manual (fallback / compat)
  sku?: string;              // bate com items[].sku dos pedidos ML
  imposto?: string;          // % de imposto sobre a venda (ex: "8" = 8%)
  mlb?: string;              // 1º código MLB (compat); ver mlbs
  mlbs?: string[];           // vários anúncios (MLB) do mesmo produto
  ativo: boolean;
  createdBy?: string;
  // Calculados pelo livro de movimentações (média móvel ponderada):
  custoMedio?: number;       // custo médio atual — usado no CMV do lucro
  qtdLocal?: number;         // estoque no galpão (entradas − envios Full − ajustes)
  // @deprecated — preço e retorno vêm automaticamente das vendas do ML
  preco?: string;
  retorno?: string;
  // @deprecated — ADS e Full agora são puxados automaticamente do ML
  ads?: string;
  custo_envio_full?: string;
};

// Livro de movimentações do estoque local (galpão).
// entrada       = compra (soma qtd no galpão, entra no custo médio, exige custoUnit)
// saldo_inicial = estoque que já existia (ex.: já no Full) — entra só no custo
//                 médio, NÃO soma no galpão. Exige custoUnit.
// saida_full    = envio pro Full (baixa qtd do galpão, NÃO é venda, não mexe no custo)
// ajuste        = correção/perda/quebra (quantidade com sinal: + ou −)
export type MovimentoTipo = "entrada" | "saldo_inicial" | "saida_full" | "ajuste";

export type EstoqueMovimento = {
  id: string;
  productId: string;
  tipo: MovimentoTipo;
  quantidade: number;        // entrada/saida_full: positivo; ajuste: com sinal
  custoUnit?: number;        // só na entrada (R$/unidade)
  data: string;              // yyyy-mm-dd
  obs?: string;
  createdBy?: string;
  createdAt?: number;
};

export type AccessEntry = {
  email: string;
  role: "owner" | "admin" | "user";
  displayName?: string;
  photoURL?: string;
  addedAt?: number;
  /**
   * Licença (SaaS): o dono libera por e-mail com prazo.
   * - expiresAt: timestamp (ms) do fim do acesso. null/ausente = sem prazo
   *   (caso do próprio dono).
   * - status: "suspenso" corta o acesso na hora, sem mexer no prazo.
   */
  expiresAt?: number | null;
  status?: "ativo" | "suspenso";
  nota?: string; // anotação do dono (ex.: "fechou na call de 12/07, anual")
};

/** Motivo pelo qual uma licença não vale — usado no servidor e na tela. */
export type LicencaInvalida = "sem_licenca" | "suspensa" | "expirada";

// ── Sugestões dos clientes ────────────────────────────────────
export type SugestaoStatus = "nova" | "analisando" | "aceita" | "recusada" | "entregue";

export type Sugestao = {
  id: string;
  email: string;          // quem enviou
  texto: string;
  categoria: "ideia" | "problema" | "outro";
  status: SugestaoStatus;
  criadoEm: number;
  resposta?: string;      // retorno do dono para o cliente
  respondidoEm?: number;
};

export const SUGESTAO_STATUS: Record<SugestaoStatus, { label: string; cor: string }> = {
  nova:       { label: "Nova",       cor: "#4f8ef7" },
  analisando: { label: "Analisando", cor: "#f7c948" },
  aceita:     { label: "Aceita",     cor: "#22c55e" },
  entregue:   { label: "Entregue",   cor: "#a855f7" },
  recusada:   { label: "Recusada",   cor: "#64748b" },
};

/** Regra ÚNICA de validade da licença. Servidor e cliente usam a mesma. */
export function licencaValida(
  entry: { expiresAt?: number | null; status?: string } | null | undefined,
  agora: number = Date.now(),
): { ok: true } | { ok: false; motivo: LicencaInvalida } {
  if (!entry) return { ok: false, motivo: "sem_licenca" };
  if (entry.status === "suspenso") return { ok: false, motivo: "suspensa" };
  // Sem expiresAt = acesso sem prazo (dono).
  if (entry.expiresAt != null && agora >= entry.expiresAt) {
    return { ok: false, motivo: "expirada" };
  }
  return { ok: true };
}