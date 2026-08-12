/**
 * "O que falta pra ser MercadoLíder" — a documentação oficial do Mercado
 * Livre bloqueia acesso automatizado (WebFetch dá 403 em mercadolivre.com.br
 * e vendedores.mercadolivre.com.br), então os números de VOLUME (vendas
 * concluídas, faturamento mínimo por nível, tempo mínimo de cadastro)
 * abaixo vêm de fontes de terceiros que DIVERGEM entre si (uma cita 90 dias
 * de cadastro, outra cita 4 meses) — por isso ficam como referência
 * INFORMATIVA, não como pass/fail. Só os critérios de QUALIDADE
 * (reclamações, cancelamentos, atraso no envio, termômetro) têm confirmação
 * cruzada entre as fontes E batem com campos reais de seller_reputation —
 * esses viram check de verdade.
 *
 * "Mediações" não tem campo próprio em seller_reputation.metrics (só
 * claims/delayed_handling_time/cancellations existem) — fica indisponível.
 */

export type StatusRequisito = "ok" | "atencao" | "informativo" | "indisponivel";

export type RequisitoMercadoLider = {
  id: string;
  label: string;
  status: StatusRequisito;
  detalhe: string;
};

const LIMITE_RECLAMACOES = 0.01; // < 1%
const LIMITE_CANCELAMENTOS = 0.005; // < 0,5%
const LIMITE_ENVIOS_ATRASADOS = 0.06; // < 6%

export type ReputationParaChecklist = {
  level_id?: string | null;
  transactions?: { completed?: number } | null;
  metrics?: {
    claims?: { rate?: number } | null;
    cancellations?: { rate?: number } | null;
    delayed_handling_time?: { rate?: number } | null;
  } | null;
};

function fmtPct(rate: number | undefined | null): string {
  return rate == null ? "sem dado" : `${(rate * 100).toFixed(2)}% atual`;
}

export function avaliarRequisitosMercadoLider(reputation: ReputationParaChecklist | null): RequisitoMercadoLider[] {
  if (!reputation) return [];
  const m = reputation.metrics;

  const reclamacoes = m?.claims?.rate;
  const cancelamentos = m?.cancellations?.rate;
  const envios = m?.delayed_handling_time?.rate;

  return [
    {
      id: "reputacao",
      label: "Termômetro de reputação verde-escuro",
      status: reputation.level_id === "5_green" ? "ok" : reputation.level_id ? "atencao" : "indisponivel",
      detalhe: reputation.level_id ? `nível atual: ${reputation.level_id}` : "sem nível calculado ainda",
    },
    {
      id: "reclamacoes",
      label: "Reclamações abaixo de 1% das vendas",
      status: reclamacoes == null ? "indisponivel" : reclamacoes < LIMITE_RECLAMACOES ? "ok" : "atencao",
      detalhe: fmtPct(reclamacoes),
    },
    {
      id: "mediacoes",
      label: "Mediações abaixo de 0,5% das vendas",
      status: "indisponivel",
      detalhe: "a API do ML não devolve esse campo separado das reclamações",
    },
    {
      id: "cancelamentos",
      label: "Cancelamentos abaixo de 0,5% das vendas",
      status: cancelamentos == null ? "indisponivel" : cancelamentos < LIMITE_CANCELAMENTOS ? "ok" : "atencao",
      detalhe: fmtPct(cancelamentos),
    },
    {
      id: "envios",
      label: "Envios com atraso abaixo de 6%",
      status: envios == null ? "indisponivel" : envios < LIMITE_ENVIOS_ATRASADOS ? "ok" : "atencao",
      detalhe: fmtPct(envios),
    },
  ];
}
