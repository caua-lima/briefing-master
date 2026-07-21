import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireAccess } from "@/lib/api-auth";
import { getMlAccessToken } from "../token";
import { SELLER_ID } from "@/lib/ml/orders";

const ML_API = "https://api.mercadolibre.com";

function normId(s: string) {
  const up = String(s).trim().toUpperCase();
  return up ? (up.startsWith("MLB") ? up : `MLB${up}`) : "";
}

type Item = { mlb: string; title: string; available: number; sold: number; status: string; inventory_id: string };

/**
 * Gestão Full: estoque por anúncio (disponível/vendido/status) + recebimentos
 * (inbound) do Full. A lista de "envios inbound" do print não é exposta pela
 * API pública do ML (só Seller Center), então mostramos o que a API entrega.
 */
export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  try {
    const token = await getMlAccessToken();
    if (!token) return NextResponse.json({ error: "sem token" }, { status: 400 });
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const db = getAdminDb();

    // MLBs cadastrados
    const prodSnap = await db.collection("estoque").get();
    const ids = new Set<string>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const list: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of list) { const n = normId(m); if (n) ids.add(n); }
    }
    const arr = Array.from(ids);

    // Estoque + inventory_id via multi-get de itens
    const itens: Item[] = [];
    const inventoryIds = new Set<string>();
    for (let i = 0; i < arr.length; i += 20) {
      const chunk = arr.slice(i, i + 20);
      const res = await fetch(`${ML_API}/items?ids=${chunk.join(",")}&attributes=id,title,available_quantity,sold_quantity,status,inventory_id,shipping`, { headers, cache: "no-store" });
      if (!res.ok) continue;
      const rows = (await res.json()) as { body?: Record<string, unknown> }[];
      for (const row of rows) {
        const b = row?.body;
        if (!b) continue;
        const shipping = (b.shipping as Record<string, unknown>) ?? {};
        const logistic = String(shipping.logistic_type ?? "");
        const inv = String(b.inventory_id ?? "");
        // Só anúncios no Full (fulfillment). Agência/Flex/self ficam de fora.
        const isFull = logistic === "fulfillment" || (logistic === "" && inv !== "");
        if (!isFull) continue;
        if (inv) inventoryIds.add(inv);
        itens.push({
          mlb: String(b.id ?? "").toUpperCase(),
          title: String(b.title ?? ""),
          available: Number(b.available_quantity ?? 0),
          sold: Number(b.sold_quantity ?? 0),
          status: String(b.status ?? ""),
          inventory_id: inv,
        });
      }
    }
    itens.sort((a, b) => b.available - a.available);

    // Recebimentos (inbound) por inventory_id — best-effort
    const invArr = Array.from(inventoryIds);
    const now = new Date(Date.now() - 3 * 3600 * 1000);
    /**
     * O ML recusa janela > 60 dias aqui, mas o limite real é a cota: pedir 55
     * dias estourou ("over quota"), porque vem uma linha por evento de
     * recebimento. 15 dias cobre de sobra o uso real — a baixa roda
     * periodicamente e só precisa das remessas novas.
     */
    const dias = Math.min(Number(new URL(req.url).searchParams.get("dias") ?? 15) || 15, 55);
    const from = new Date(now.getTime() - dias * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    const recebimentos: { data: string; quantidade: number; inventory_id: string; tipo: string }[] = [];
    let opStatus = 0;
    let opErro = ""; // corpo do erro do ML — sem isso o diagnóstico fica cego
    let opUrl = "";
    const tiposVistos = new Set<string>();
    let amostra = "";
    /**
     * O ML emite uma linha por evento de recebimento (palete/caixa). Nela:
     *   detail = o que entrou NESTE evento  → é isso que forma a remessa
     *   result = o saldo do produto no Full DEPOIS da operação (não somar!)
     * Somar `result` daria 152 numa remessa de 80, porque 152 é o estoque.
     * Então acumulamos `detail` por remessa e guardamos `result` só como
     * informação do saldo, tirado do evento mais recente.
     */
    type Agg = {
      data: string; recebido: number; problema: number;
      inventories: Set<string>; saldoData: string; saldo: number;
    };
    const porRemessaAgg = new Map<string, Agg>();
    let truncado = false;
    // O tipo vem em MAIÚSCULA (a doc diz minúsculo — por isso era recusado).
    // Sem esse filtro a página enche de SALE_CONFIRMATION e os recebimentos
    // somem: foi o que fez aparecerem só 3 de ~8 envios reais.
    const LIMITE = 100;
    let cotaEstourada = false;
    for (let i = 0; i < invArr.length && !cotaEstourada; i += 20) {
      const chunk = invArr.slice(i, i + 20);
      // Teto baixo de propósito: 3000 estourou a cota do ML (HTTP 429).
      for (let offset = 0; offset < 500; offset += LIMITE) {
        if (offset + LIMITE >= 500) truncado = true;
        if (offset > 0) await new Promise((r) => setTimeout(r, 200));
        let lote = 0;
        try {
          const path =
            `/stock/fulfillment/operations/search?seller_id=${SELLER_ID}` +
            `&inventory_id=${chunk.join(",")}&type=INBOUND_RECEPTION` +
            `&date_from=${from}&date_to=${to}&limit=${LIMITE}&offset=${offset}`;
          const res = await fetch(`${ML_API}${path}`, { headers, cache: "no-store" });
          opStatus = res.status;
          if (!res.ok) {
            if (!opErro) {
              opErro = (await res.text().catch(() => "")).slice(0, 300);
              opUrl = path.slice(0, 200);
            }
            // Insistir depois de estourar a cota só piora — para tudo.
            if (res.status === 429) cotaEstourada = true;
            break;
          }
          const j = (await res.json()) as { results?: Record<string, unknown>[]; data?: Record<string, unknown>[] };
          const linhas = j.results ?? j.data ?? [];
          lote = linhas.length;
          for (const r of linhas) {
            const tipo = String(r.type ?? r.operation_type ?? "");
            tiposVistos.add(tipo);
            if (!amostra) amostra = JSON.stringify(r).slice(0, 900);

            const refs = (r.external_references ?? []) as { type?: string; value?: string }[];
            const remessa = String(refs.find((x) => x?.type === "inbound_id")?.value ?? "");
            const inventory = String(r.inventory_id ?? "");
            const quando = String(r.date_created ?? "");
            const data = quando.slice(0, 10);

            const det = (r.detail ?? {}) as Record<string, unknown>;
            const detProblemas = (det.not_available_detail ?? []) as { status?: string; quantity?: number }[];
            const entrou = Number(det.available_quantity ?? 0);
            const ruins = detProblemas.reduce((s, p) => s + Number(p?.quantity ?? 0), 0);

            const res2 = (r.result ?? {}) as Record<string, unknown>;

            const agg = porRemessaAgg.get(remessa) ?? {
              data, recebido: 0, problema: 0, inventories: new Set<string>(), saldoData: "", saldo: 0,
            };
            agg.recebido += entrou;
            agg.problema += ruins;
            if (inventory) agg.inventories.add(inventory);
            if (data < agg.data) agg.data = data;
            // Ordenamos por date_created: o `id` do ML passa de 9e15 e o
            // JSON.parse já o arredonda, então comparar id não é confiável.
            if (quando > agg.saldoData) {
              agg.saldoData = quando;
              agg.saldo = Number(res2.total ?? 0);
            }
            porRemessaAgg.set(remessa, agg);

            recebimentos.push({ data, quantidade: entrou, inventory_id: inventory, tipo });
          }
        } catch { break; }
        if (lote < LIMITE) break;
      }
    }
    recebimentos.sort((a, b) => b.data.localeCompare(a.data));

    // Uma remessa (#71140809) pode conter vários produtos: somamos os
    // inventory_id dela para poder comparar com a tela do Seller Center.
    const tituloPorInventory = new Map<string, string>();
    for (const it of itens) if (it.inventory_id) tituloPorInventory.set(it.inventory_id, it.title);

    const remessas = Array.from(porRemessaAgg.entries())
      .map(([remessa, a]) => ({
        remessa: remessa || "—",
        data: a.data,
        recebido: a.recebido,
        problema: a.problema,
        saldoFull: a.saldo,
        produtos: Array.from(a.inventories).map((inv) => tituloPorInventory.get(inv) ?? inv),
      }))
      .sort((x, y) => y.data.localeCompare(x.data));

    const totalDisponivel = itens.reduce((s, it) => s + it.available, 0);
    const totalVendido = itens.reduce((s, it) => s + it.sold, 0);

    return NextResponse.json({ itens, recebimentos, totalDisponivel, totalVendido, temInventory: invArr.length > 0, opStatus, opErro, opUrl, tiposVistos: Array.from(tiposVistos), amostra, remessas, truncado, linhasBrutas: recebimentos.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "gestao_full_failed", details: msg }, { status: 500 });
  }
}
