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

export type ImpostoFaixa = {
  desde: string;             // yyyy-mm-dd — primeira data em que a alíquota vale
  pct: number;               // ex.: 4 = 4%
};

/**
 * Alíquota que vale na data da venda. Sem faixas, cai no campo antigo, que
 * valia para todo o histórico. Antes da primeira faixa, 0.
 */
export function impostoNaData(
  prod: { imposto?: string | number; impostoFaixas?: ImpostoFaixa[] },
  dataISO: string,
): number {
  const faixas = prod.impostoFaixas;
  if (!faixas?.length) return Number(prod.imposto ?? 0) || 0;
  const dia = String(dataISO).slice(0, 10);
  let melhor: ImpostoFaixa | null = null;
  for (const f of faixas) {
    if (!f?.desde || f.desde > dia) continue;
    if (!melhor || f.desde > melhor.desde) melhor = f;
  }
  return melhor ? Number(melhor.pct) || 0 : 0;
}

export type Product = {
  id: string;
  name: string;
  custo: string;             // custo manual (fallback / compat)
  sku?: string;              // bate com items[].sku dos pedidos ML
  imposto?: string;          // % de imposto sobre a venda (ex: "8" = 8%)
  /**
   * Faixas de vigência do imposto, em ordem qualquer. A alíquota de uma venda
   * é a da faixa mais recente cujo `desde` <= data da venda. Venda anterior à
   * primeira faixa paga 0 — foi o caso da virada de MEI (isento) para ME.
   * Sem faixas, `imposto` vale para todo o histórico (comportamento antigo).
   */
  impostoFaixas?: ImpostoFaixa[];
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
};