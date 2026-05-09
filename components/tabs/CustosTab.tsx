"use client";

import { useEffect, useState } from "react";
import {
  fmtBRL,
  mesAtual,
  todayStr,
  totalCustosMes,
} from "@/lib/domain/calc";
import type { Cost } from "@/lib/domain/types";
import { deleteCost, upsertCost } from "@/lib/firebase/data";
import type { UserData } from "@/components/useUserData";

export default function CustosTab({
  uid,
  data,
}: {
  uid: string;
  data: UserData;
}) {
  const totalDia = data.costs
    .filter((c) => c.freq === "diario")
    .reduce((s, c) => s + (parseFloat(c.valor) || 0), 0);
  const totalMes = totalCustosMes(data.costs, mesAtual());

  function newId() {
    return "c" + Date.now() + Math.random().toString(36).slice(2, 6);
  }

  function onAdd() {
    const cost: Cost = {
      id: newId(),
      nome: "",
      valor: "",
      freq: "diario",
      data: todayStr(),
    };
    upsertCost(uid, cost).catch(() => {});
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700 }}>
          💸 Custos Operacionais
        </h2>
        <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>
          ＋ Adicionar Custo
        </button>
      </div>
      <div
        style={{
          fontSize: ".82rem",
          color: "var(--muted)",
          marginBottom: 16,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 16px",
        }}
      >
        💡 <strong>Diário</strong> = desconta todo dia do lucro líquido &nbsp;·
        &nbsp;
        <strong>Mensal</strong> = total mensal (aparece nas metas) &nbsp;·&nbsp;
        <strong>Avulso</strong> = descontado apenas na data informada
      </div>
      {data.costs.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 40,
            color: "var(--muted)",
          }}
        >
          Nenhum custo cadastrado.
          <br />
          Clique em <strong>＋ Adicionar Custo</strong>.
        </div>
      ) : (
        data.costs.map((c) => (
          <CustoRow key={c.id} uid={uid} cost={c} />
        ))
      )}
      {data.costs.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
              gap: 12,
              marginTop: 4,
            }}
          >
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  fontSize: ".72rem",
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  marginBottom: 4,
                }}
              >
                💸 Custo Fixo/Dia
              </div>
              <div
                style={{
                  fontSize: "1.2rem",
                  fontWeight: 700,
                  color: "var(--red)",
                }}
              >
                {fmtBRL(totalDia)}
              </div>
              <div
                style={{
                  fontSize: ".75rem",
                  color: "var(--muted)",
                  marginTop: 2,
                }}
              >
                Descontado do L.Líquido diário
              </div>
            </div>
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  fontSize: ".72rem",
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  marginBottom: 4,
                }}
              >
                📆 Custo Total do Mês
              </div>
              <div
                style={{
                  fontSize: "1.2rem",
                  fontWeight: 700,
                  color: "var(--red)",
                }}
              >
                {fmtBRL(totalMes)}
              </div>
              <div
                style={{
                  fontSize: ".75rem",
                  color: "var(--muted)",
                  marginTop: 2,
                }}
              >
                Fixos × dias + mensais + avulsos
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CustoRow({ uid, cost }: { uid: string; cost: Cost }) {
  const [nome, setNome] = useState(cost.nome);
  const [valor, setValor] = useState(cost.valor);
  const [freq, setFreq] = useState<Cost["freq"]>(cost.freq);
  const [dataAvulso, setDataAvulso] = useState(cost.data || todayStr());

  // Sync incoming changes from snapshots (other tabs / first-load)
  useEffect(() => {
    setNome(cost.nome);
    setValor(cost.valor);
    setFreq(cost.freq);
    setDataAvulso(cost.data || todayStr());
  }, [cost.nome, cost.valor, cost.freq, cost.data]);

  // Debounced auto-save
  useEffect(() => {
    const handle = setTimeout(() => {
      const next: Cost = { id: cost.id, nome, valor, freq, data: dataAvulso };
      // skip save if unchanged
      if (
        next.nome === cost.nome &&
        next.valor === cost.valor &&
        next.freq === cost.freq &&
        next.data === cost.data
      ) {
        return;
      }
      upsertCost(uid, next).catch(() => {});
    }, 350);
    return () => clearTimeout(handle);
  }, [nome, valor, freq, dataAvulso, cost, uid]);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 10,
        display: "grid",
        gridTemplateColumns: "1fr auto auto auto auto",
        gap: 10,
        alignItems: "center",
      }}
    >
      <input
        type="text"
        placeholder="Nome do custo (ex: Envio Full)"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        style={{
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          padding: "8px 10px",
          color: "var(--text)",
          fontSize: ".9rem",
          outline: "none",
          width: "100%",
        }}
      />
      <input
        type="number"
        min="0"
        step="0.01"
        placeholder="R$ 0,00"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        style={{
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          padding: "8px 10px",
          color: "var(--text)",
          fontSize: ".9rem",
          outline: "none",
          width: 100,
        }}
      />
      <select
        value={freq}
        onChange={(e) => setFreq(e.target.value as Cost["freq"])}
        style={{
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          padding: "8px 10px",
          color: "var(--text)",
          fontSize: ".88rem",
          outline: "none",
        }}
      >
        <option value="diario">📅 Diário</option>
        <option value="mensal">🗓 Mensal</option>
        <option value="avulso">⚡ Avulso</option>
      </select>
      <input
        type="date"
        value={dataAvulso}
        onChange={(e) => setDataAvulso(e.target.value)}
        style={{
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          padding: "8px 10px",
          color: "var(--text)",
          fontSize: ".88rem",
          outline: "none",
          display: freq === "avulso" ? "block" : "none",
        }}
      />
      <button
        type="button"
        className="btn btn-danger btn-xs"
        onClick={() => deleteCost(uid, cost.id).catch(() => {})}
      >
        🗑
      </button>
    </div>
  );
}
