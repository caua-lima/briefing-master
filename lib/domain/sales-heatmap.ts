/**
 * Concentração de vendas por dia da semana e horário — mesma ideia do painel
 * "Concentração de vendas por dia e horário" do próprio Mercado Livre
 * (Métricas > Negócio), só que calculada em cima dos pedidos já
 * sincronizados, sem bater em API nenhuma.
 *
 * dia/hora extraídos por FATIA DE TEXTO da própria date_created (já vem com
 * o horário local do vendedor, igual ao resto do app faz em
 * app/api/ml/pedidos/route.ts: data/hora = slice da string, sem reparse de
 * timezone) — só o dia (YYYY-MM-DD) precisa virar Date pra achar o dia da
 * semana, e isso é feito com componentes locais (new Date(y, m-1, d)), o
 * mesmo truque já usado em MelhoresDias (components/dashboard/Dashboard.tsx).
 */

export type OrderParaHeatmap = {
  date_created?: string;
};

export type ResultadoHeatmap = {
  /** grid[diaSemana 0-6][hora 0-23] = nº de vendas. 0=domingo, como Date.getDay(). */
  grid: number[][];
  totalVendas: number;
  diaMaisForte: number | null;
  horaMaisForte: number | null;
};

/**
 * Converte pro horário de Brasília ANTES de ler dia/hora.
 *
 * O ML devolve `date_created` com o offset local ("...T14:32:10.000-03:00"),
 * e nesse caso fatiar a string já dá o horário certo. Mas o fallback de
 * leitura do Firestore (loadOrders) também aceita janela em UTC, e pedido
 * gravado como "...T17:32:10.000Z" fatiado dá 17h — três horas adiantado.
 * Isso deslocaria o "horário com mais vendas" e, perto da meia-noite, jogaria
 * a venda pro dia da semana errado.
 *
 * Só timestamps marcados como UTC (sufixo Z) são convertidos; os que já vêm
 * com offset explícito continuam sendo lidos por fatia, sem reparse — mesmo
 * critério usado em app/api/ml/pedidos/route.ts.
 */
function paraHorarioBR(iso: string): { dia: string; hora: number } | null {
  if (!iso || iso.length < 13) return null;
  if (/Z$/i.test(iso)) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    const br = new Date(t - 3 * 3600 * 1000);
    const dia = `${br.getUTCFullYear()}-${String(br.getUTCMonth() + 1).padStart(2, "0")}-${String(br.getUTCDate()).padStart(2, "0")}`;
    return { dia, hora: br.getUTCHours() };
  }
  const hora = Number(iso.slice(11, 13));
  if (!Number.isFinite(hora) || hora < 0 || hora > 23) return null;
  return { dia: iso.slice(0, 10), hora };
}

export function calcularConcentracaoVendas(orders: OrderParaHeatmap[]): ResultadoHeatmap {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let totalVendas = 0;

  for (const o of orders) {
    const conv = paraHorarioBR(o.date_created ?? "");
    if (!conv) continue;
    const [y, m, d] = conv.dia.split("-").map(Number);
    const hora = conv.hora;
    if (!y || !m || !d) continue;
    const diaSemana = new Date(y, m - 1, d).getDay();
    grid[diaSemana][hora]++;
    totalVendas++;
  }

  const totaisPorDia = grid.map((linha) => linha.reduce((s, n) => s + n, 0));
  const totaisPorHora = new Array(24).fill(0);
  for (const linha of grid) for (let h = 0; h < 24; h++) totaisPorHora[h] += linha[h];

  const diaMaisForte = totalVendas > 0 ? totaisPorDia.indexOf(Math.max(...totaisPorDia)) : null;
  const horaMaisForte = totalVendas > 0 ? totaisPorHora.indexOf(Math.max(...totaisPorHora)) : null;

  return { grid, totalVendas, diaMaisForte, horaMaisForte };
}
