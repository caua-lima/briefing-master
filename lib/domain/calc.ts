import type { ComputedAd, Cost, DaySummary, Listing } from "./types";

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function todayStr(): string {
  return localDateStr(new Date());
}
export function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateStr(d);
}
export function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}
export function mesAtual(): string {
  return todayStr().slice(0, 7);
}
export function diaAtualNoMes(): number {
  return new Date().getDate();
}
export function diasNoMes(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
export function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
export function formatMesBR(ym: string): string {
  const [y, m] = ym.split("-");
  return new Date(+y, +m - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}
export function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-");
  return new Date(+y, +m - 1, +d).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
export function fmtBRL(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
export function colorClass(v: number): "positive" | "negative" | "neutral" {
  return v > 0 ? "positive" : v < 0 ? "negative" : "neutral";
}
export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function emptyListing(): Listing {
  return { name: "", preco: "", retorno: "", custo: "", vendas: "", ads: "" };
}

export function parseBRNumber(raw: string | undefined | null): number {
  if (raw === undefined || raw === null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let normalized: string;
  if (hasComma && hasDot) {
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = s.replace(",", ".");
  } else {
    normalized = s;
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function computeAd(a: Listing): ComputedAd {
  const preco = parseBRNumber(a.preco);
  const retorno = parseBRNumber(a.retorno);
  const custo = parseBRNumber(a.custo);
  const vendas = parseInt(a.vendas, 10) || 0;
  const adsp = parseBRNumber(a.ads);
  const faturamento = preco * vendas;
  const cmv = custo * vendas;
  const bruto = retorno * vendas - cmv;
  const liquido = bruto - adsp;
  const margem = faturamento > 0 ? (liquido / faturamento) * 100 : 0;
  const roas = adsp > 0 ? faturamento / adsp : null;
  return {
    name: a.name?.trim() || "Sem nome",
    faturamento,
    cmv,
    bruto,
    liquido,
    margem,
    ads: adsp,
    roas,
  };
}

export function computeSummary(adsRaw: Listing[]): DaySummary {
  let tF = 0,
    tCMV = 0,
    tB = 0,
    tL = 0,
    tA = 0;
  const ads = adsRaw.map((a) => {
    const r = computeAd(a);
    tF += r.faturamento;
    tCMV += r.cmv;
    tB += r.bruto;
    tL += r.liquido;
    tA += r.ads;
    return r;
  });
  return {
    ads,
    totalFaturamento: tF,
    totalCMV: tCMV,
    totalBruto: tB,
    totalLiquido: tL,
    totalAds: tA,
    totalRoas: tA > 0 ? tF / tA : null,
    totalMargem: tF > 0 ? (tL / tF) * 100 : 0,
  };
}

function normalizeCostDate(raw: string | undefined): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

export function totalCustosDia(custos: Cost[], dateISO = todayStr()): number {
  return custos.reduce((s, item) => {
    const v = parseBRNumber(item.valor);
    if (item.freq === "diario") return s + v;
    if (item.freq === "avulso" && normalizeCostDate(item.data) === dateISO) return s + v;
    return s;
  }, 0);
}

export function totalCustosMes(custos: Cost[], mes: string): number {
  return custos.reduce((s, item) => {
    const v = parseBRNumber(item.valor);
    if (item.freq === "diario") return s + v * diasNoMes(mes);
    if (item.freq === "mensal") return s + v;
    if (item.freq === "avulso") {
      const norm = normalizeCostDate(item.data);
      if (norm?.startsWith(mes)) return s + v;
    }
    return s;
  }, 0);
}
