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
  preco: string;
  custo: string;
  retorno: string;
  mlb?: string;
  ativo: boolean;
  createdBy?: string;
};

export type AccessEntry = {
  email: string;
  role: "owner" | "admin" | "user";
  displayName?: string;
  photoURL?: string;
  addedAt?: number;
};
