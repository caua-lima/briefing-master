/**
 * Recorte de período no fuso de Brasília.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────
 *
 * O faturamento do app fechava ACIMA do "Vendas brutas" do Seller Center, e
 * a causa eram as vendas da BORDA do período, contadas duas vezes de duas
 * formas diferentes:
 *
 * 1. `String(date_created).slice(0, 10)` lê o dia NO FUSO QUE VEIO na string,
 *    não no nosso. O ML devolve o instante com offset próprio, então uma
 *    venda das 22h de 31/07 podia ser lida como 01/08 — jogando faturamento
 *    pro mês errado bem na virada, que é justamente quando alguém confere.
 *
 * 2. O fallback do Firestore consulta uma janela UTC e uma janela BR e UNE as
 *    duas. A união cobre de `from` 00:00 UTC até `to` 23:59 BR — ou seja,
 *    arrasta as 3 últimas horas do dia ANTERIOR ao período pra dentro do
 *    resultado. Pelo mapa de calor de vendas da conta, 21h–00h é faixa
 *    movimentada: sobra real, todo mês.
 *
 * A regra que sai disso: o dia de um pedido é o dia CIVIL EM BRASÍLIA do
 * instante em que ele foi criado, e só entra no período quem cai dentro dele.
 */

/** Offset fixo de Brasília. O Brasil não usa mais horário de verão (desde 2019). */
const BR_OFFSET_MS = 3 * 3600 * 1000;

/**
 * Dia civil BR (YYYY-MM-DD) do instante em `dateCreated`.
 *
 * Aceita qualquer formato que `Date.parse` entenda (ISO com Z, com offset, com
 * milissegundos). Data impossível de interpretar cai pro corte cru da string
 * — pior que o certo, melhor que descartar o pedido em silêncio.
 */
export function diaBRDe(dateCreated: string): string {
  const t = Date.parse(dateCreated);
  if (!Number.isFinite(t)) return String(dateCreated).slice(0, 10);
  const d = new Date(t - BR_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Separa os pedidos cujo dia BR cai em [fromStr, toStr] dos que ficam de fora.
 *
 * `foraDaJanela` não é descarte silencioso: a contagem sobe pra resposta da
 * API e aparece no painel de conferência. Se ela for > 0, é a borda de fuso
 * agindo — e o usuário vê que o corte aconteceu em vez de só ver um total
 * mudar sem explicação.
 */
export function recortarPorDiaBR<T extends { date_created?: unknown }>(
  pedidos: T[],
  fromStr: string,
  toStr: string,
): { dentro: T[]; foraDaJanela: number } {
  const dentro: T[] = [];
  let foraDaJanela = 0;
  for (const o of pedidos) {
    const dia = diaBRDe(String(o.date_created ?? ""));
    if (dia >= fromStr && dia <= toStr) dentro.push(o);
    else foraDaJanela++;
  }
  return { dentro, foraDaJanela };
}
