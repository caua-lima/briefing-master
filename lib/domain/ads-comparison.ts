// Comparação com período anterior equivalente (puro). Regras da missão:
//  - mês corrente em andamento: compara com os MESMOS N dias do mês anterior;
//  - mês fechado (from=dia 1, to=último dia do mês): compara com o mês
//    anterior completo;
//  - intervalo customizado: desloca a janela pra trás pelo mesmo número de
//    dias, sem sobrepor o período atual.
// Delta é CONTEXTO, nunca decisão isolada — quem consome isso (AdsDecisionPanel)
// não deve recomendar escalar/reduzir só por causa de um delta.

export type Periodo = { from: string; to: string };

const DIA_MS = 86400000;

function toUTCms(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromUTCms(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Quantidade de dias no período, inclusive nas duas pontas. */
export function diasNoPeriodo(from: string, to: string): number {
  return Math.round((toUTCms(to) - toUTCms(from)) / DIA_MS) + 1;
}

function primeiroDiaDoMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function ultimoDiaDoMes(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return fromUTCms(Date.UTC(y, m, 0)); // dia 0 do mês seguinte = último dia deste mês
}

function mesAnteriorAAA_MM(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const ym = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return `${ym.y}-${String(ym.m).padStart(2, "0")}`;
}

/**
 * Deriva o período anterior equivalente. `hojeISO` precisa vir de quem chama
 * (não usa Date.now() aqui pra continuar puro/testável).
 */
export function derivarPeriodoAnterior(periodo: Periodo, hojeISO: string): Periodo {
  const { from, to } = periodo;
  const mesmoMes = from.slice(0, 7) === to.slice(0, 7);
  const comecaNoDia1 = from === primeiroDiaDoMes(from);

  if (mesmoMes && comecaNoDia1 && to === hojeISO) {
    // Mês corrente em andamento — mesmos N dias do mês anterior.
    const aaaMm = mesAnteriorAAA_MM(from);
    const fromAnt = `${aaaMm}-01`;
    const diaAtual = Number(to.slice(8, 10));
    const ultimoDiaAnt = Number(ultimoDiaDoMes(fromAnt).slice(8, 10));
    const diaFinal = Math.min(diaAtual, ultimoDiaAnt);
    return { from: fromAnt, to: `${aaaMm}-${String(diaFinal).padStart(2, "0")}` };
  }

  if (mesmoMes && comecaNoDia1 && to === ultimoDiaDoMes(from)) {
    // Mês fechado completo — mês anterior completo.
    const fromAnt = `${mesAnteriorAAA_MM(from)}-01`;
    return { from: fromAnt, to: ultimoDiaDoMes(fromAnt) };
  }

  // Intervalo customizado — desloca pra trás o mesmo número de dias, sem sobrepor.
  const dias = diasNoPeriodo(from, to);
  const toAnt = fromUTCms(toUTCms(from) - DIA_MS);
  const fromAnt = fromUTCms(toUTCms(toAnt) - (dias - 1) * DIA_MS);
  return { from: fromAnt, to: toAnt };
}

export type ComparacaoMetrica = {
  atual: number;
  anterior: number | null;
  deltaAbsoluto: number | null;
  /** null quando anterior === 0 (variação percentual não é definida contra base zero). */
  deltaPercentual: number | null;
};

export function compararMetrica(atual: number, anterior: number | null): ComparacaoMetrica {
  if (anterior == null) return { atual, anterior: null, deltaAbsoluto: null, deltaPercentual: null };
  const deltaAbsoluto = atual - anterior;
  const deltaPercentual = anterior !== 0 ? (deltaAbsoluto / Math.abs(anterior)) * 100 : null;
  return { atual, anterior, deltaAbsoluto, deltaPercentual };
}

/**
 * "Não comparar se período anterior não tiver dados suficientes" — zero
 * investimento E zero vendas não é "queda de 100%", é ausência de operação
 * (ex.: campanha nem existia, produto não estava anunciado ainda).
 */
export function periodoAnteriorTemDadosSuficientes(investimentoAnterior: number, vendasAnterior: number): boolean {
  return investimentoAnterior > 0 || vendasAnterior > 0;
}
