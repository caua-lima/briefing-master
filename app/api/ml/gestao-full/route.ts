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

    // MLBs cadastrados no Estoque — servem para saber o que já é rastreado.
    const prodSnap = await db.collection("estoque").get();
    const cadastrados = new Set<string>();
    for (const doc of prodSnap.docs) {
      const d = doc.data();
      const list: string[] = Array.isArray(d.mlbs) && d.mlbs.length ? d.mlbs : d.mlb ? [String(d.mlb)] : [];
      for (const m of list) { const n = normId(m); if (n) cadastrados.add(n); }
    }

    /**
     * A busca de operações exige inventory_id ("The field inventory_id is
     * required"), então precisamos de TODOS os anúncios da conta: usar só os
     * cadastrados escondia unidades e a remessa fechava a menos.
     */
    const ids = new Set<string>(cadastrados);
    for (let offset = 0; offset < 1000; offset += 100) {
      const res = await fetch(`${ML_API}/users/${SELLER_ID}/items/search?limit=100&offset=${offset}`, { headers, cache: "no-store" });
      if (!res.ok) break;
      const j = (await res.json()) as { results?: string[] };
      const lote = j.results ?? [];
      for (const m of lote) { const n = normId(m); if (n) ids.add(n); }
      if (lote.length < 100) break;
    }
    const arr = Array.from(ids);

    // Estoque + inventory_id via multi-get de itens
    const itens: Item[] = [];
    const inventoryIds = new Set<string>();
    for (let i = 0; i < arr.length; i += 20) {
      const chunk = arr.slice(i, i + 20);
      const res = await fetch(`${ML_API}/items?ids=${chunk.join(",")}&attributes=id,title,available_quantity,sold_quantity,status,inventory_id,shipping,variations`, { headers, cache: "no-store" });
      if (!res.ok) continue;
      const rows = (await res.json()) as { body?: Record<string, unknown> }[];
      for (const row of rows) {
        const b = row?.body;
        if (!b) continue;
        const shipping = (b.shipping as Record<string, unknown>) ?? {};
        const logistic = String(shipping.logistic_type ?? "");
        const inv = String(b.inventory_id ?? "");
        /**
         * Anúncio com variação (sabor, tamanho) não tem inventory_id na raiz:
         * cada variação tem o seu. Lendo só a raiz, essas unidades ficavam
         * invisíveis — é o que fazia duas remessas fecharem 20 a menos.
         */
        const variacoes = (b.variations ?? []) as Record<string, unknown>[];
        const invsVariacao = variacoes
          .map((v) => ({ inv: String(v.inventory_id ?? ""), qtd: Number(v.available_quantity ?? 0) }))
          .filter((v) => v.inv);

        // Só anúncios no Full (fulfillment). Agência/Flex/self ficam de fora.
        const temInv = inv !== "" || invsVariacao.length > 0;
        const isFull = logistic === "fulfillment" || (logistic === "" && temInv);
        if (!isFull) continue;

        const mlb = String(b.id ?? "").toUpperCase();
        const title = String(b.title ?? "");
        const status = String(b.status ?? "");
        if (inv) {
          inventoryIds.add(inv);
          itens.push({
            mlb, title, status, inventory_id: inv,
            available: Number(b.available_quantity ?? 0),
            sold: Number(b.sold_quantity ?? 0),
          });
        }
        for (const v of invsVariacao) {
          inventoryIds.add(v.inv);
          itens.push({ mlb, title, status, inventory_id: v.inv, available: v.qtd, sold: 0 });
        }
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
    const dias = Math.min(Number(new URL(req.url).searchParams.get("dias") ?? 25) || 25, 55);
    const from = new Date(now.getTime() - dias * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);

    /**
     * Modo auditoria: a soma por INBOUND_RECEPTION fecha abaixo do que o
     * Seller Center mostra (60 contra 80). Aqui testamos as duas hipóteses
     * que sobraram, de uma vez:
     *   1. filtrar por external_references traria a remessa inteira, inclusive
     *      de inventory_id que não conhecemos;
     *   2. outros tipos (QUARANTINE_RESTOCK, ADJUSTMENT…) completam a conta.
     * Fica atrás de um parâmetro porque é mais pesado em cota.
     */
    const auditar = new URL(req.url).searchParams.get("auditar");
    if (auditar) {
      const alvo = auditar === "1" ? "" : auditar;
      const q = `seller_id=${SELLER_ID}`;
      const inv20 = invArr.slice(0, 20).join(",");
      const formas = alvo
        ? [
            `/stock/fulfillment/operations/search?${q}&external_references.inbound_id=${alvo}&limit=5`,
            `/stock/fulfillment/operations/search?${q}&external_references=${alvo}&limit=5`,
            `/stock/fulfillment/operations/search?${q}&inbound_id=${alvo}&limit=5`,
            `/stock/fulfillment/operations/search?${q}&inventory_id=${inv20}&external_references.inbound_id=${alvo}&date_from=${from}&date_to=${to}&limit=5`,
          ]
        : [];
      const probes: { forma: string; status: number; linhas: number; corpo: string }[] = [];
      for (const path of formas) {
        try {
          const res = await fetch(`${ML_API}${path}`, { headers, cache: "no-store" });
          const txt = await res.text().catch(() => "");
          let linhas = -1;
          try {
            const j = JSON.parse(txt) as { results?: unknown[] };
            linhas = Array.isArray(j.results) ? j.results.length : -1;
          } catch { /* corpo não-JSON */ }
          probes.push({
            forma: (path.split("?")[1] ?? "").replace(`seller_id=${SELLER_ID}&`, "").slice(0, 120),
            status: res.status, linhas, corpo: txt.slice(0, 160),
          });
        } catch (e) {
          probes.push({ forma: path.slice(0, 120), status: -1, linhas: -1, corpo: String(e).slice(0, 120) });
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      // Varredura sem filtro de tipo, agregando por remessa × tipo.
      const porTipo = new Map<string, { remessa: string; tipo: string; unidades: number; linhas: number }>();
      let varreduraStatus = 0;
      let varreduraErro = "";
      let lidas = 0;
      for (let i = 0; i < invArr.length; i += 20) {
        const chunk = invArr.slice(i, i + 20);
        for (let offset = 0; offset < 600; offset += 100) {
          if (offset > 0) await new Promise((r) => setTimeout(r, 250));
          const path =
            `/stock/fulfillment/operations/search?${q}&inventory_id=${chunk.join(",")}` +
            `&date_from=${from}&date_to=${to}&limit=100&offset=${offset}`;
          const res = await fetch(`${ML_API}${path}`, { headers, cache: "no-store" });
          varreduraStatus = res.status;
          if (!res.ok) {
            if (!varreduraErro) varreduraErro = (await res.text().catch(() => "")).slice(0, 200);
            break;
          }
          const j = (await res.json()) as { results?: Record<string, unknown>[] };
          const linhas = j.results ?? [];
          lidas += linhas.length;
          for (const r of linhas) {
            const refs = (r.external_references ?? []) as { type?: string; value?: string }[];
            const remessa = String(refs.find((x) => x?.type === "inbound_id")?.value ?? "");
            // Sem inbound_id é venda/ajuste solto: não interessa aqui.
            if (!remessa) continue;
            const tipo = String(r.type ?? "");
            const det = (r.detail ?? {}) as Record<string, unknown>;
            const ruins = ((det.not_available_detail ?? []) as { quantity?: number }[])
              .reduce((s, p) => s + Number(p?.quantity ?? 0), 0);
            const chave = `${remessa}|${tipo}`;
            const at = porTipo.get(chave) ?? { remessa, tipo, unidades: 0, linhas: 0 };
            at.unidades += Number(det.available_quantity ?? 0) + ruins;
            at.linhas += 1;
            porTipo.set(chave, at);
          }
          if (linhas.length < 100) break;
        }
        if (varreduraStatus === 429) break;
      }

      return NextResponse.json({
        auditoria: {
          probes,
          varreduraStatus,
          varreduraErro,
          lidas,
          janela: { from, to },
          porTipo: Array.from(porTipo.values()).sort(
            (a, b) => a.remessa.localeCompare(b.remessa) || b.unidades - a.unidades,
          ),
        },
      });
    }

    const recebimentos: { data: string; quantidade: number; inventory_id: string; tipo: string }[] = [];
    let opStatus = 0;
    let opErro = ""; // corpo do erro do ML — sem isso o diagnóstico fica cego
    let opUrl = "";
    const tiposVistos = new Set<string>();
    let amostra = "";
    const amostras: string[] = [];
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
      porInventory: Map<string, number>; saldoData: string; saldo: number;
    };
    const porRemessaAgg = new Map<string, Agg>();
    let truncado = false;
    // O tipo vem em MAIÚSCULA (a doc diz minúsculo — por isso era recusado).
    // Sem esse filtro a página enche de SALE_CONFIRMATION e os recebimentos
    // somem: foi o que fez aparecerem só 3 de ~8 envios reais.
    const LIMITE = 100;
    // O ML exige inventory_id, então mandamos todos os do Full de uma vez.
    for (let i = 0; i < invArr.length; i += 20) {
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
            break;
          }
          const j = (await res.json()) as { results?: Record<string, unknown>[]; data?: Record<string, unknown>[] };
          const linhas = j.results ?? j.data ?? [];
          lote = linhas.length;
          for (const r of linhas) {
            const tipo = String(r.type ?? r.operation_type ?? "");
            tiposVistos.add(tipo);
            // 60 recebidas contra 80 na tela do ML: faltam 20 e não dá pra
            // saber onde sem ver as linhas. São poucas — mostramos todas.
            if (!amostra) amostra = JSON.stringify(r).slice(0, 900);
            if (amostras.length < 25) amostras.push(JSON.stringify(r).slice(0, 500));

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
              data, recebido: 0, problema: 0, porInventory: new Map<string, number>(), saldoData: "", saldo: 0,
            };
            agg.recebido += entrou;
            agg.problema += ruins;
            if (inventory) agg.porInventory.set(inventory, (agg.porInventory.get(inventory) ?? 0) + entrou);
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
    const tituloPorInventory = new Map<string, { nome: string; cadastrado: boolean }>();
    for (const it of itens) {
      if (!it.inventory_id) continue;
      const jaTem = tituloPorInventory.get(it.inventory_id);
      const cad = cadastrados.has(it.mlb);
      // Um inventory_id pode servir a mais de um anúncio: basta um cadastrado.
      if (!jaTem || (cad && !jaTem.cadastrado)) {
        tituloPorInventory.set(it.inventory_id, { nome: it.title, cadastrado: cad || (jaTem?.cadastrado ?? false) });
      }
    }

    const remessas = Array.from(porRemessaAgg.entries())
      .map(([remessa, a]) => ({
        remessa: remessa || "—",
        data: a.data,
        recebido: a.recebido,
        problema: a.problema,
        saldoFull: a.saldo,
        // Produto sem cadastro aparece pelo inventory_id cru e marcado — é
        // exatamente o caso que fazia a remessa fechar a menos.
        produtos: Array.from(a.porInventory.entries())
          .sort((p, q) => q[1] - p[1])
          .map(([inv, qtd]) => ({
            inventory: inv,
            nome: tituloPorInventory.get(inv)?.nome ?? "",
            cadastrado: tituloPorInventory.get(inv)?.cadastrado ?? false,
            qtd,
          })),
      }))
      .sort((x, y) => y.data.localeCompare(x.data));

    const totalDisponivel = itens.reduce((s, it) => s + it.available, 0);
    const totalVendido = itens.reduce((s, it) => s + it.sold, 0);

    return NextResponse.json({ itens, recebimentos, totalDisponivel, totalVendido, temInventory: invArr.length > 0, opStatus, opErro, opUrl, tiposVistos: Array.from(tiposVistos), amostra, amostras, remessas, truncado, linhasBrutas: recebimentos.length, dias, inventariosConsultados: invArr.length, anunciosDaConta: arr.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "gestao_full_failed", details: msg }, { status: 500 });
  }
}
