"use client";

import { useEffect, useState } from "react";
import type { EstoqueMovimento } from "@/lib/domain/types";
import { watchMovimentos } from "@/lib/firebase/data";
import { useAccess } from "@/components/tabs/AccessGuard";
import type { UserData } from "@/components/useUserData";
import ColetasAgendadas from "@/components/tabs/full/ColetasAgendadas";
import RemessasFull from "@/components/tabs/full/RemessasFull";

/**
 * Aba exclusiva do Full — ciclo de vida completo, do agendamento da coleta
 * até a baixa de estoque quando o Mercado Livre confirma o recebimento:
 *   1. Coletas agendadas (manual, ver ColetasAgendadas.tsx) — a API do ML
 *      não expõe "agendado"/"em trânsito".
 *   2. Remessas pro Full (RemessasFull.tsx, movido de dentro do Estoque) —
 *      baixa de estoque a partir do que o ML JÁ recebeu, dado real da API.
 */
export default function FullTab({ data }: { data: UserData }) {
  const { canEditTab } = useAccess();
  const canEdit = canEditTab("estoque");

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
        Do agendamento da coleta até a baixa de estoque — recebimento e baixa detectados e aplicados automaticamente
        assim que o Mercado Livre confirma.
      </div>

      <ColetasAgendadas products={data.products} canEdit={canEdit} movimentos={movimentos} />
      <RemessasFull movimentos={movimentos} />
    </div>
  );
}
