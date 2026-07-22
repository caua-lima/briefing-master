"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/api/authed-fetch";
import { watchMovimentos, watchRemessasIgnoradas } from "@/lib/firebase/data";
import { remessasPendentes, type Remessa } from "@/lib/domain/remessas";
import type { EstoqueMovimento } from "@/lib/domain/types";

/**
 * Avisa que chegou remessa no Full sem baixa no estoque. Fica no Dashboard
 * porque é a tela aberta todo dia — depender de lembrar de visitar o Estoque
 * era justamente o que fazia o lançamento atrasar.
 *
 * Silencioso quando não há pendência: nada de banner vazio ocupando espaço.
 */
export default function AvisoRemessasFull({ onVerEstoque }: { onVerEstoque?: () => void }) {
  const [remessas, setRemessas] = useState<Remessa[]>([]);
  const [movimentos, setMovimentos] = useState<EstoqueMovimento[]>([]);
  const [ignoradas, setIgnoradas] = useState<Set<string>>(new Set());

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await authedFetch("/api/ml/gestao-full", { cache: "no-store" });
        if (!r.ok || !vivo) return;
        const j = (await r.json()) as { remessas?: Remessa[] };
        if (vivo) setRemessas(j.remessas ?? []);
      } catch { /* aviso é acessório: falhar aqui não pode quebrar o Dashboard */ }
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => watchMovimentos(setMovimentos), []);
  useEffect(() => watchRemessasIgnoradas(setIgnoradas), []);

  const pendentes = remessasPendentes(remessas, movimentos, ignoradas);
  if (!pendentes.length) return null;

  const unidades = pendentes.reduce((s, r) => s + r.recebido, 0);

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between",
      padding: "11px 14px", marginBottom: 14, borderRadius: 10,
      background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.4)",
      fontSize: ".84rem", color: "#f7c948", lineHeight: 1.5,
    }}>
      <div>
        <b>
          {pendentes.length === 1 ? "1 remessa chegou no Full" : `${pendentes.length} remessas chegaram no Full`}
        </b>{" "}
        e ainda não deram baixa no estoque — {unidades} unidade{unidades === 1 ? "" : "s"}
        {" "}({pendentes.map((r) => `#${r.remessa}`).join(", ")}).
      </div>
      {onVerEstoque && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onVerEstoque}>
          Dar baixa
        </button>
      )}
    </div>
  );
}
