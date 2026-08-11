// Helpers puros compartilhados entre EstoqueTab.tsx e os modais/painéis
// extraídos dela (Fase 10: modularização — mesmo código de antes, só
// movido pra um lugar que os componentes filhos também podem importar sem
// depender do arquivo gigante de novo).

import type { Product } from "@/lib/domain/types";

export type MlItem = { available: number; sold: number; status: string; price: number; regularPrice: number; hasPromo: boolean; logistic: string };
export type EstoqueML = Record<string, MlItem>;
export type Forecast = { vendas: Record<string, number>; dias: number };

export function ehFullLogistic(l: string) {
  return l === "fulfillment";
}

// dias-alvo de cobertura pra sugestão de reposição
export const DIAS_ALVO = 30;

export function newId() {
  return "p" + Date.now() + Math.random().toString(36).slice(2, 6);
}
export function newMovId() {
  return "mov" + Date.now() + Math.random().toString(36).slice(2, 6);
}
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function parseNum(s: string): number {
  const n = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function mlbsDe(p: Product): string[] {
  if (p.mlbs && p.mlbs.length) return p.mlbs;
  return p.mlb ? [p.mlb] : [];
}

export function normMlb(s: string) {
  const up = s.trim().toUpperCase();
  return up.startsWith("MLB") ? up : up ? `MLB${up}` : "";
}

export function custoMedioDe(p: Product): number {
  return p.custoMedio ?? parseNum(p.custo);
}

// Anúncios (MLBs) do produto com os dados do ML de cada um.
export type AnuncioML = { mlb: string; item: MlItem | null };
export function anunciosDe(p: Product, estoqueML: EstoqueML): AnuncioML[] {
  return mlbsDe(p).map((m) => ({ mlb: normMlb(m), item: estoqueML[normMlb(m)] ?? null }));
}

// Estoque do ML por logística: qtd = Full (fulfillment); proprio = anúncio
// próprio (não-Full). ehFull = tem anúncio no Full. temDado = ML já respondeu.
export function fullDe(p: Product, estoqueML: EstoqueML): { qtd: number; proprio: number; ehFull: boolean; temDado: boolean } {
  let qtd = 0, proprio = 0, ehFull = false, temDado = false;
  for (const { item } of anunciosDe(p, estoqueML)) {
    if (!item) continue;
    temDado = true;
    if (ehFullLogistic(item.logistic)) { ehFull = true; qtd += item.available; }
    else proprio += item.available;
  }
  return { qtd, proprio, ehFull, temDado };
}

/**
 * Estoque físico FORA do Full: casa (controle manual, ex.: compras ainda não
 * lançadas no anúncio) MAIS o que está disponível no(s) anúncio(s) próprio(s)
 * (envio por conta do vendedor/agência) — são dois lotes físicos distintos,
 * não o mesmo estoque contado duas vezes. Reportado com exemplo real: 23+8
 * unidades em dois anúncios "Clássico" (agência, não Full) mais 10 no
 * controle manual = 41 no total; a versão anterior descartava os 31 do
 * anúncio sempre que havia QUALQUER controle manual (nem que fosse 1
 * unidade), mostrando só "10 un" e separando os 31 como se fossem só
 * informativos.
 */
export function foraDoFullDe(casa: number, proprio: number): number {
  return casa + proprio;
}

// Full considerado "baixo" sugere reabastecer com o estoque de casa.
export const FULL_BAIXO = 5;

// Faixa de preços dos anúncios (por anúncio, sem média). Retorna min/max/único.
export function precosDe(p: Product, estoqueML: EstoqueML): { min: number; max: number; temPromo: boolean; count: number } {
  const precos: number[] = [];
  let temPromo = false;
  for (const { item } of anunciosDe(p, estoqueML)) {
    if (!item || !item.price) continue;
    precos.push(item.price);
    if (item.hasPromo) temPromo = true;
  }
  if (!precos.length) return { min: 0, max: 0, temPromo: false, count: 0 };
  return { min: Math.min(...precos), max: Math.max(...precos), temPromo, count: precos.length };
}

export type PrevisaoProduto = {
  precoMin: number;
  precoMax: number;
  casa: number;
  full: number;
  proprio: number;
  ehFull: boolean;
  total: number;
  mediaDiaria: number;
  cobertura: number;    // dias até acabar o total (Infinity = sem vendas ou sem estoque)
  valorPotencial: number;
  reporQtd: number;     // unidades pra levar o Full a cobrir DIAS_ALVO (só produtos no Full)
};

export function previsaoDe(p: Product, estoqueML: EstoqueML, forecast: Forecast): PrevisaoProduto {
  const casa = Math.max(p.qtdLocal ?? 0, 0);
  const { qtd: full, proprio, ehFull } = fullDe(p, estoqueML);
  const foraFull = foraDoFullDe(casa, proprio);
  const total = full + foraFull;
  const { min: precoMin, max: precoMax } = precosDe(p, estoqueML);
  // Venda potencial: o Full pelo preço de cada anúncio (estoque separado); o
  // que está fora do Full uma vez só, pelo melhor preço (é o mesmo estoque
  // exposto no anúncio próprio, não soma de novo).
  let potencialFull = 0;
  let precoProprioMax = 0;
  for (const { item } of anunciosDe(p, estoqueML)) {
    if (!item) continue;
    if (ehFullLogistic(item.logistic)) potencialFull += item.available * item.price;
    else precoProprioMax = Math.max(precoProprioMax, item.price);
  }
  const valorPotencial = potencialFull + foraFull * (precoProprioMax || precoMax || precoMin);
  const mediaDiaria = forecast.dias > 0 ? (forecast.vendas[p.id] ?? 0) / forecast.dias : 0;
  const cobertura = mediaDiaria > 0 && total > 0 ? total / mediaDiaria : Infinity;
  // Reposição só faz sentido pra quem está no Full.
  const reporQtd = ehFull && mediaDiaria > 0 ? Math.max(0, Math.ceil(mediaDiaria * DIAS_ALVO) - full) : 0;
  return { precoMin, precoMax, casa, full, proprio, ehFull, total, mediaDiaria, cobertura, valorPotencial, reporQtd };
}
