/**
 * Lembrete de prazo das tarefas.
 *
 * POR QUE EXISTE
 * O aviso de tarefa só disparava no momento da ATRIBUIÇÃO, e só quando a
 * tarefa ia pra outra pessoa (quem se auto-atribui não é notificado — acabou
 * de clicar em Salvar, já sabe). O efeito prático num quadro tocado por pouca
 * gente é que a notificação de tarefa quase nunca acontecia: você cria a
 * tarefa pra você mesmo, marca um prazo, e o app nunca mais toca no assunto.
 * O prazo chegava e passava em silêncio.
 *
 * Aqui é o outro gatilho, o que faltava: uma varredura diária do que vence
 * HOJE e do que já está atrasado.
 *
 * ANTI-RUÍDO
 * UMA notificação por pessoa por dia, somando tudo — nunca uma por tarefa.
 * Cinco tarefas atrasadas viram um aviso que diz "5 atrasadas" e nomeia a mais
 * urgente, não cinco pushes seguidos. É a mesma regra do resumo de vendas
 * (buildGroupedSalesContent): alerta que empilha ensina a pessoa a ignorar.
 *
 * Puro de propósito (sem Firestore/rede) — a rota lê as tarefas e chama isto.
 */

export type TarefaPrazo = {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
  priority?: "baixa" | "media" | "alta" | "critica";
  /** "yyyy-mm-dd". Sem prazo = nada a lembrar. */
  dueDate?: string;
  /** Sem responsável não há pra quem avisar. */
  assignedTo?: string;
};

export type LembretePessoa = {
  email: string;
  venceHoje: TarefaPrazo[];
  atrasadas: TarefaPrazo[];
};

const PESO: Record<string, number> = { critica: 0, alta: 1, media: 2, baixa: 3 };

/** "yyyy-mm-dd" -> ms UTC. Null quando o formato não bate. */
function paraUTC(dia: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Quantos dias `dueDate` está atrasado em relação a `hoje`. Negativo = ainda
 * no futuro, 0 = vence hoje. Compara em UTC puro: as duas pontas são datas de
 * calendário ("yyyy-mm-dd"), então fuso não entra na conta e não há como
 * escorregar um dia por causa de horário de verão.
 */
export function diasAtraso(dueDate: string, hoje: string): number {
  const a = paraUTC(dueDate);
  const b = paraUTC(hoje);
  if (a == null || b == null) return 0;
  return Math.round((b - a) / 86400000);
}

function ordenar(a: TarefaPrazo, b: TarefaPrazo): number {
  const pa = PESO[a.priority ?? "media"] ?? 2;
  const pb = PESO[b.priority ?? "media"] ?? 2;
  // Prioridade primeiro; empatou, o prazo mais antigo vem na frente.
  return pa - pb || String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? ""));
}

/**
 * Agrupa por responsável o que vence hoje e o que já passou do prazo.
 * Ignora: concluídas, sem responsável, sem prazo válido e prazo no futuro.
 */
export function agruparLembretes(tarefas: TarefaPrazo[], hoje: string): LembretePessoa[] {
  const porEmail = new Map<string, LembretePessoa>();

  for (const t of tarefas) {
    if (t.status === "done") continue;
    const email = String(t.assignedTo ?? "").trim().toLowerCase();
    if (!email) continue;
    const due = String(t.dueDate ?? "").trim();
    if (paraUTC(due) == null) continue;

    const atraso = diasAtraso(due, hoje);
    if (atraso < 0) continue; // ainda não é hora de incomodar

    let entrada = porEmail.get(email);
    if (!entrada) {
      entrada = { email, venceHoje: [], atrasadas: [] };
      porEmail.set(email, entrada);
    }
    (atraso === 0 ? entrada.venceHoje : entrada.atrasadas).push(t);
  }

  for (const e of porEmail.values()) {
    e.venceHoje.sort(ordenar);
    e.atrasadas.sort(ordenar);
  }
  return [...porEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

const plural = (n: number, singular: string, plural_: string) => (n === 1 ? singular : plural_);

/**
 * Título e corpo do push. A má notícia (atraso) manda no título quando existe
 * — "vence hoje" ainda dá pra resolver, atrasado já estourou.
 */
export function textoLembrete(l: LembretePessoa, hoje: string): { title: string; body: string } | null {
  const nA = l.atrasadas.length;
  const nH = l.venceHoje.length;
  if (nA === 0 && nH === 0) return null;

  const title =
    nA > 0
      ? `${nA} ${plural(nA, "tarefa atrasada", "tarefas atrasadas")}`
      : `${nH} ${plural(nH, "tarefa vence", "tarefas vencem")} hoje`;

  // Nomeia a mais urgente: um número sozinho não diz o que fazer.
  const destaque = l.atrasadas[0] ?? l.venceHoje[0];
  const partes: string[] = [];

  if (nA > 0) {
    const d = diasAtraso(String(destaque.dueDate ?? ""), hoje);
    const dias = d > 0 ? ` (${d} ${plural(d, "dia", "dias")})` : "";
    partes.push(`${destaque.title}${dias}`);
  } else {
    partes.push(destaque.title);
  }

  const restantes = nA + nH - 1;
  if (restantes > 0) partes.push(`+${restantes} ${plural(restantes, "outra", "outras")}`);
  if (nA > 0 && nH > 0) partes.push(`${nH} ${plural(nH, "vence", "vencem")} hoje`);

  return { title, body: partes.join(" · ") };
}
