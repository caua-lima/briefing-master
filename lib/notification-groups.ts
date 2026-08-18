import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { tenantCol } from "@/lib/tenant";

const JANELA_MS = 90 * 1000;
const LIMIAR_AGRUPAMENTO = 4; // a partir da 4ª venda na janela, vira resumo

/**
 * Contador de vendas empurradas (via push individual) numa janela deslizante
 * de 90s, guardado num doc único porque o ambiente é serverless — não dá pra
 * manter isso em memória entre invocações da função. Transação garante que
 * duas vendas quase simultâneas não pisem uma na outra e "esqueçam" de contar
 * uma delas.
 *
 * Regras (replicando o pedido): até 3 vendas na janela mandam push
 * individual; a 4ª em diante entra no MESMO resumo agregado até a janela
 * fechar — só a 4ª venda dispara o push (o resumo), as 5ª/6ª/... da mesma
 * janela só incrementam o contador sem mandar push de novo, pra não virar
 * "resumo a cada venda".
 */
const JANELA_MINUTOS = Math.max(1, Math.round(JANELA_MS / 60000));

export type DecisaoAgrupamento =
  | { modo: "individual" }
  | { modo: "resumo_dispara"; totalNaJanela: number; grossAcumulado: number; janelaMinutos: number }
  | { modo: "resumo_silencioso"; totalNaJanela: number };

/**
 * Chamado só para vendas classificáveis pro fluxo de push normal
 * (sale_paid/sale_high_value/sale_low_margin) — NUNCA para prejuízo,
 * cancelamento ou devolução, que o chamador já filtra antes de chegar aqui
 * (esses continuam sempre individuais, ver app/api/ml/webhook/route.ts).
 */
export async function registrarVendaNaJanela(tenantId: string, grossAmount: number): Promise<DecisaoAgrupamento> {
  // Um doc por TENANT (não um global): sem isso, a venda de um cliente
  // contaria na janela de agrupamento de outro — o resumo de um poderia
  // somar o faturamento do outro dentro de "grossAcumulado".
  const ref = tenantCol(tenantId, "pushRateWindow").doc("vendas");
  const now = Date.now();

  return ref.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data()! : null;
    const windowStart = data?.windowStart instanceof Timestamp ? data.windowStart.toMillis() : 0;
    const dentroDaJanela = data != null && now - windowStart < JANELA_MS;

    if (!dentroDaJanela) {
      tx.set(ref, {
        windowStart: FieldValue.serverTimestamp(),
        count: 1,
        grossAcumulado: grossAmount,
        resumoDisparado: false,
      });
      return { modo: "individual" } as const;
    }

    const count = Number(data?.count ?? 0) + 1;
    const grossAcumulado = Number(data?.grossAcumulado ?? 0) + grossAmount;
    const resumoDisparado = data?.resumoDisparado === true;

    tx.update(ref, { count, grossAcumulado });

    if (count < LIMIAR_AGRUPAMENTO) return { modo: "individual" } as const;
    if (!resumoDisparado) {
      tx.update(ref, { resumoDisparado: true });
      return { modo: "resumo_dispara", totalNaJanela: count, grossAcumulado, janelaMinutos: JANELA_MINUTOS } as const;
    }
    return { modo: "resumo_silencioso", totalNaJanela: count } as const;
  });
}
