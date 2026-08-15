/**
 * Conversão de timestamp do Mercado Livre para o horário de Brasília.
 *
 * O BUG QUE ISTO CORRIGE
 * O app lia dia e hora FATIANDO a string ISO (`slice(11, 16)`), o que assume
 * que o timestamp já vem no fuso de Brasília. Não vem: o Mercado Livre
 * devolve `date_created` com o offset da conta/serviço, que na prática sai
 * como `-04:00`. Fatiar mostrava a hora daquele offset, e a venda das 13:01
 * aparecia como 12:01 — uma hora atrás, em toda a aba Pedidos e no mapa de
 * concentração por horário.
 *
 * A correção não é "somar 1 hora": é converter de verdade, respeitando o
 * offset que veio no próprio timestamp. Somar constante quebraria de novo no
 * dia em que o ML mudar o offset, e erraria o DIA nas vendas perto da
 * meia-noite (que é justamente onde o heatmap mais engana).
 *
 * Usa Intl com `America/Sao_Paulo` em vez de `-03:00` fixo de propósito: se o
 * Brasil voltar a ter horário de verão, o fuso nomeado acompanha sozinho e o
 * offset fixo não.
 */

const FUSO_BR = "America/Sao_Paulo";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_BR,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

export type InstanteBR = {
  /** "YYYY-MM-DD" no fuso de Brasília. */
  dia: string;
  /** "HH:MM" no fuso de Brasília. */
  hora: string;
  /** Hora cheia (0-23), pro heatmap. */
  horaNum: number;
};

/**
 * Converte qualquer timestamp ISO (com offset, com Z, ou sem nada) pro fuso
 * de Brasília. Devolve null quando não dá pra interpretar — quem chama decide
 * o que fazer, em vez de receber uma data inventada.
 *
 * Timestamp SEM offset é tratado como já sendo horário de Brasília: é o que o
 * resto do app assume quando grava data à mão (ex.: `data` de movimentação de
 * estoque, que é só "YYYY-MM-DD").
 */
export function paraBR(iso: string | undefined | null): InstanteBR | null {
  if (!iso) return null;
  const texto = String(iso).trim();
  if (texto.length < 10) return null;

  // Só data, sem hora: não há o que converter — devolve como está.
  if (texto.length === 10) {
    return { dia: texto, hora: "00:00", horaNum: 0 };
  }

  const temFuso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(texto);
  // Sem fuso explícito o Date interpretaria como horário LOCAL do servidor
  // (que na Vercel é UTC), o que deslocaria tudo em 3h. Marcamos como -03:00
  // pra manter a leitura "isto já é horário de Brasília".
  const normalizado = temFuso ? texto : `${texto}-03:00`;

  const ms = Date.parse(normalizado);
  if (!Number.isFinite(ms)) return null;

  const partes = fmt.formatToParts(new Date(ms));
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const ano = get("year");
  const mes = get("month");
  const dia = get("day");
  let hh = get("hour");
  // Intl pode devolver "24" pra meia-noite em algumas engines com hour12:false.
  if (hh === "24") hh = "00";
  const mm = get("minute");
  if (!ano || !mes || !dia) return null;

  return {
    dia: `${ano}-${mes}-${dia}`,
    hora: `${hh}:${mm}`,
    horaNum: Number(hh),
  };
}

/** Só o dia no fuso BR — atalho pros lugares que filtram por data. */
export function diaBR(iso: string | undefined | null): string {
  return paraBR(iso)?.dia ?? "";
}
