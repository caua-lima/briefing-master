"use client";

import { useEffect, useState } from "react";
import { fmtBRL, mesAtual, todayStr, totalCustosMes, diasNoMes } from "@/lib/domain/calc";
import { COST_CATEGORIA_LABEL, type Cost, type CostCategoria } from "@/lib/domain/types";
import { deleteCost, logAudit, upsertCost } from "@/lib/firebase/data";
import type { UserData } from "@/components/useUserData";
import { useAccess } from "@/components/tabs/AccessGuard";
import { authedFetch } from "@/lib/api/authed-fetch";

function newId() {
  return "c" + Date.now() + Math.random().toString(36).slice(2, 6);
}

// Quanto o custo pesa no mês atual (fixo × dias, mensal cheio, avulso no mês).
function impactoMes(c: Cost, dias: number): number {
  const v = parseFloat(c.valor) || 0;
  if (c.freq === "diario") return v * dias;
  if (c.freq === "mensal") return v;
  // avulso: só conta se for do mês corrente
  return (c.data ?? "").slice(0, 7) === mesAtual() ? v : 0;
}

export default function CustosTab({ uid, data }: { uid: string; data: UserData }) {
  const { canEdit } = useAccess();
  const dias = diasNoMes(mesAtual());
  const [mostrarArquivados, setMostrarArquivados] = useState(false);
  // Arquivado (ativo:false) para de contar em tudo — mesmo filtro que a rota
  // de métricas do Dashboard aplica, senão "Arquivar" não significaria nada.
  const ativos = data.costs.filter((c) => c.ativo !== false);
  const arquivados = data.costs.filter((c) => c.ativo === false);
  // Os totais aqui são os que batem no Dashboard. Custo marcado "só na DRE"
  // fica de fora, senão o número desta tela não explicaria o de lá.
  const doDash = ativos.filter((c) => (c.escopo ?? "dash") === "dash");
  const soDre = ativos.filter((c) => c.escopo === "dre");
  const totalDia = doDash.filter((c) => c.freq === "diario").reduce((s, c) => s + (parseFloat(c.valor) || 0), 0);
  const totalMensais = doDash.filter((c) => c.freq === "mensal").reduce((s, c) => s + (parseFloat(c.valor) || 0), 0);
  const totalMes = totalCustosMes(doDash, mesAtual());
  const totalMesDre = totalCustosMes(soDre, mesAtual());
  const nDiario = doDash.filter((c) => c.freq === "diario").length;
  const nMensal = doDash.filter((c) => c.freq === "mensal").length;

  // Impacto % no faturamento e no lucro (antes dos custos operacionais) do
  // mes atual — mesma rota que o Dashboard ja usa, so pra dar contexto aqui.
  const [impactoRef, setImpactoRef] = useState<{ faturamentoLiquido: number; lucroSemCustos: number } | null>(null);
  useEffect(() => {
    let vivo = true;
    authedFetch(`/api/ml/metrics?month=${mesAtual()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo && j) setImpactoRef({ faturamentoLiquido: j.faturamentoLiquido ?? 0, lucroSemCustos: j.lucroSemCustos ?? 0 }); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);
  const impactoFaturamentoPct = impactoRef && impactoRef.faturamentoLiquido > 0 ? (totalMes / impactoRef.faturamentoLiquido) * 100 : null;
  const impactoLucroPct = impactoRef && impactoRef.lucroSemCustos > 0 ? (totalMes / impactoRef.lucroSemCustos) * 100 : null;

  function onAdd() {
    const id = newId();
    upsertCost(uid, { id, nome: "", valor: "", freq: "diario", data: todayStr() }).catch(() => {});
    logAudit({ acao: "criar", entidade: "custo", entidadeId: id, entidadeLabel: "(novo custo)" }).catch(() => {});
  }

  return (
    <div className="dash">
      <div className="tab-head">
        <div className="tab-head-left"><h2 className="tab-title">Custos Operacionais</h2></div>
        {canEdit && (
          <div className="tab-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>＋ Adicionar Custo</button>
          </div>
        )}
      </div>

      <div className="kpi-grid">
        <div className="kpi k-neg"><div className="k-lbl">Custo fixo / dia</div><div className="k-val" style={{ color: "var(--red)" }}>{fmtBRL(totalDia)}</div><div className="k-sub">{nDiario} diário(s) · desconta todo dia</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Mensais fixos</div><div className="k-val" style={{ color: "var(--yellow)" }}>{fmtBRL(totalMensais)}</div><div className="k-sub">{nMensal} custo(s) · 1×/mês</div></div>
        <div className="kpi k-neg"><div className="k-lbl">Impacto no mês</div><div className="k-val" style={{ color: "var(--red)" }}>{fmtBRL(totalMes)}</div><div className="k-sub">fixos × {dias}d + mensais + avulsos</div></div>
        <div className="kpi k-acc"><div className="k-lbl">Só na DRE</div><div className="k-val" style={{ color: soDre.length ? "var(--purple)" : "var(--muted)" }}>{fmtBRL(totalMesDre)}</div><div className="k-sub">{soDre.length} custo(s) · fora do Dashboard</div></div>
        <div className="kpi k-warn">
          <div className="k-lbl">Impacto no faturamento</div>
          <div className="k-val" style={{ color: "var(--yellow)" }}>{impactoFaturamentoPct != null ? `${impactoFaturamentoPct.toFixed(1)}%` : "—"}</div>
          <div className="k-sub">custos ÷ faturamento líquido do mês</div>
        </div>
        <div className="kpi k-neg">
          <div className="k-lbl">Impacto no lucro</div>
          <div className="k-val" style={{ color: "var(--red)" }}>{impactoLucroPct != null ? `${impactoLucroPct.toFixed(1)}%` : "—"}</div>
          <div className="k-sub" title="Lucro antes de descontar estes custos operacionais">% do lucro (antes destes custos) que eles consomem</div>
        </div>
      </div>

      <div className="note note-accent">
        <strong>Diário</strong> = desconta todo dia · <strong>Mensal</strong> = só no lucro do mês · <strong>Avulso</strong> = apenas na data informada
        <div style={{ marginTop: 4 }}>
          <strong>Desconta no Dashboard</strong> = custo da operação de venda, entra no lucro líquido ·
          {" "}<strong>Só na DRE</strong> = despesa da empresa (pró-labore, contador, retirada), aparece apenas na aba DRE
        </div>
      </div>

      <div className="panel">
        {arquivados.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMostrarArquivados((v) => !v)}>
              {mostrarArquivados ? "Ocultar" : "Mostrar"} arquivados ({arquivados.length})
            </button>
          </div>
        )}
        {ativos.length === 0 ? (
          <div className="empty-state">
            <span className="empty-ico">💸</span>
            Nenhum custo cadastrado.<br />Clique em <strong>＋ Adicionar Custo</strong>.
          </div>
        ) : (
          <div className="list-stack">
            {ativos.map((c) => (<CustoRow key={c.id} uid={uid} cost={c} canEdit={canEdit} impacto={impactoMes(c, dias)} />))}
          </div>
        )}
        {mostrarArquivados && arquivados.length > 0 && (
          <div className="list-stack" style={{ marginTop: 16, opacity: 0.6 }}>
            {arquivados.map((c) => (<CustoRow key={c.id} uid={uid} cost={c} canEdit={canEdit} impacto={0} />))}
          </div>
        )}
      </div>
    </div>
  );
}

const FREQ_META: Record<Cost["freq"], { cor: string; label: string }> = {
  diario: { cor: "var(--red)", label: "Diário" },
  mensal: { cor: "var(--yellow)", label: "Mensal" },
  avulso: { cor: "var(--purple)", label: "Avulso" },
};

function CustoRow({ uid, cost, canEdit, impacto }: { uid: string; cost: Cost; canEdit: boolean; impacto: number }) {
  const [nome, setNome] = useState(cost.nome);
  const [valor, setValor] = useState(cost.valor);
  const [freq, setFreq] = useState<Cost["freq"]>(cost.freq);
  const [dataAvulso, setDataAvulso] = useState(cost.data || todayStr());
  const [escopo, setEscopo] = useState<NonNullable<Cost["escopo"]>>(cost.escopo ?? "dash");
  const [categoria, setCategoria] = useState<CostCategoria | "">(cost.categoria ?? "");
  const [centroCusto, setCentroCusto] = useState(cost.centroCusto ?? "");
  const [observacao, setObservacao] = useState(cost.observacao ?? "");

  useEffect(() => {
    setNome(cost.nome); setValor(cost.valor); setFreq(cost.freq); setDataAvulso(cost.data || todayStr());
    setEscopo(cost.escopo ?? "dash");
    setCategoria(cost.categoria ?? ""); setCentroCusto(cost.centroCusto ?? ""); setObservacao(cost.observacao ?? "");
  }, [cost.nome, cost.valor, cost.freq, cost.data, cost.escopo, cost.categoria, cost.centroCusto, cost.observacao]);

  useEffect(() => {
    if (!canEdit) return;
    const handle = setTimeout(() => {
      const next: Cost = {
        id: cost.id, nome, valor, freq, data: dataAvulso, escopo,
        categoria: categoria || undefined, centroCusto: centroCusto || undefined, observacao: observacao || undefined,
      };
      if (next.nome === cost.nome && next.valor === cost.valor && next.freq === cost.freq
        && next.data === cost.data && next.escopo === (cost.escopo ?? "dash")
        && next.categoria === (cost.categoria ?? undefined) && next.centroCusto === (cost.centroCusto ?? undefined)
        && next.observacao === (cost.observacao ?? undefined)) return;
      upsertCost(uid, next).catch(() => {});
    }, 350);
    return () => clearTimeout(handle);
  }, [nome, valor, freq, dataAvulso, escopo, categoria, centroCusto, observacao, cost, uid, canEdit]);

  const meta = FREQ_META[freq];
  const ro = !canEdit;
  return (
    <div className="list-row" style={{ borderLeft: `3px solid ${meta.cor}` }}>
      {/* Cabeçalho: identifica o custo e o quanto ele pesa — o que se lê primeiro */}
      <div className="list-row-split" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "1 1 220px", minWidth: 0 }}>
          <span className="chip" style={{ color: meta.cor, background: `${meta.cor}1a`, borderColor: `${meta.cor}55` }}>{meta.label}</span>
          <input
            className="inp" type="text" placeholder="Ex: Mercado Turbo, aluguel…"
            value={nome} onChange={(e) => setNome(e.target.value)} readOnly={ro}
            aria-label="Nome do custo" style={{ fontWeight: 600 }}
          />
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: ".62rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>no mês</div>
          <div style={{ fontWeight: 800, color: "var(--red)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtBRL(impacto)}</div>
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <label>Valor</label>
          <div className="inp-wrap">
            <span className="inp-prefix">R$</span>
            <input
              className="inp inp-money" type="number" min="0" step="0.01" placeholder="0,00"
              value={valor} onChange={(e) => setValor(e.target.value)} readOnly={ro}
            />
          </div>
        </div>
        <div className="field">
          <label>Frequência</label>
          <select className="inp" value={freq} onChange={(e) => setFreq(e.target.value as Cost["freq"])} disabled={ro} style={{ color: meta.cor, fontWeight: 600 }}>
            <option value="diario">Diário</option>
            <option value="mensal">Mensal</option>
            <option value="avulso">Avulso</option>
          </select>
        </div>
        {freq === "avulso" && (
          <div className="field">
            <label>Data</label>
            <input className="inp" type="date" value={dataAvulso} onChange={(e) => setDataAvulso(e.target.value)} readOnly={ro} />
          </div>
        )}
        <div className="field">
          <label>Onde desconta</label>
          <select
            className="inp" value={escopo}
            onChange={(e) => setEscopo(e.target.value as NonNullable<Cost["escopo"]>)}
            disabled={ro} title="Desconta no Dashboard = custo da operação de venda (ex.: embalagem). Só na DRE = despesa da empresa (ex.: pró-labore, contador) — não aparece no lucro do dia a dia."
          >
            <option value="dash">Desconta no Dashboard</option>
            <option value="dre">Só na DRE</option>
          </select>
        </div>
        <div className="field">
          <label>Categoria {!categoria && <span style={{ color: "#F4B942", fontWeight: 700 }}>· sem categoria</span>}</label>
          <select className="inp" value={categoria} onChange={(e) => setCategoria(e.target.value as CostCategoria | "")} disabled={ro}>
            <option value="">— sem categoria —</option>
            {(Object.keys(COST_CATEGORIA_LABEL) as CostCategoria[]).map((c) => (
              <option key={c} value={c}>{COST_CATEGORIA_LABEL[c]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Centro de custo (opcional)</label>
          <input className="inp" type="text" placeholder="Ex: Anúncios ML, Galpão…" value={centroCusto} onChange={(e) => setCentroCusto(e.target.value)} readOnly={ro} />
        </div>
        <div className="field">
          <label>Observação (opcional)</label>
          <input className="inp" type="text" placeholder="Ex: contrato até dez/2026" value={observacao} onChange={(e) => setObservacao(e.target.value)} readOnly={ro} />
        </div>
      </div>

      {canEdit && (
        <div className="row-actions" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          {cost.ativo === false ? (
            <button
              type="button" className="btn btn-ghost btn-xs"
              onClick={() => {
                upsertCost(uid, { ...cost, ativo: true }).catch(() => {});
                logAudit({ acao: "reativar", entidade: "custo", entidadeId: cost.id, entidadeLabel: cost.nome || "(sem nome)" }).catch(() => {});
              }}
            >
              Reativar
            </button>
          ) : (
            <button
              type="button" className="btn btn-ghost btn-xs"
              onClick={() => {
                if (!confirm(`Arquivar "${cost.nome || "este custo"}"? Ele some da lista ativa, mas o histórico continua.`)) return;
                upsertCost(uid, { ...cost, ativo: false }).catch(() => {});
                logAudit({ acao: "arquivar", entidade: "custo", entidadeId: cost.id, entidadeLabel: cost.nome || "(sem nome)" }).catch(() => {});
              }}
            >
              Arquivar
            </button>
          )}
          <button
            type="button" className="btn btn-danger btn-xs"
            onClick={() => {
              if (!confirm(`Excluir "${cost.nome || "este custo"}" definitivamente? Essa ação não pode ser desfeita — considere Arquivar em vez disso.`)) return;
              deleteCost(uid, cost.id).catch(() => {});
              logAudit({ acao: "excluir", entidade: "custo", entidadeId: cost.id, entidadeLabel: cost.nome || "(sem nome)" }).catch(() => {});
            }}
          >
            Excluir
          </button>
        </div>
      )}
    </div>
  );
}
