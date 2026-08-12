"use client";

import { useEffect, useState } from "react";
import type { EstoqueMovimento } from "@/lib/domain/types";
import { watchMovimentos } from "@/lib/firebase/data";
import RemessasFull from "@/components/tabs/full/RemessasFull";

/**
 * Aba exclusiva do Full — baixa de estoque a partir do que o Mercado Livre
 * JÁ recebeu, dado real da API. Chegou a ter um bloco de "coleta agendada"
 * manual, removido: a API do ML não expõe agendamento/trânsito, então era
 * um formulário 100% manual sem automação nenhuma — só dava trabalho.
 */
export default function FullTab() {
  const [movimentos, setMovimentos] = useState<EstoqueMovimento[]>([]);
  useEffect(() => watchMovimentos(setMovimentos), []);

  return (
    <div className="dash">
      <div className="tab-head">
        <div className="tab-head-left">
          <h2 className="tab-title">Full</h2>
        </div>
      </div>
      <div style={{ fontSize: ".8rem", color: "var(--muted)", marginTop: -6 }}>
        Baixa de estoque a partir do que o Mercado Livre já recebeu — detectado e aplicado automaticamente.
      </div>

      <RemessasFull movimentos={movimentos} />
    </div>
  );
}
