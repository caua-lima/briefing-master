"use client";

import { useState } from "react";
import type { ForegroundPushEvent } from "@/lib/firebase/push";

type ItemPedido = { title: string; quantity: number };

/** Nunca deixa um JSON malformado (ou ausente) derrubar o toast — sem itens é só "sem detalhe pra expandir", não erro. */
function parseItens(json: string | undefined): ItemPedido[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((i) => i && typeof i.title === "string") : [];
  } catch {
    return [];
  }
}

type Tone = "success" | "warning" | "danger" | "info";

function toneDeTipo(type: string): Tone {
  switch (type) {
    case "sale_high_value": return "success";
    case "sale_low_margin": return "warning";
    case "sale_negative_margin": case "sale_cancelled": case "return_completed": case "return_opened": return "danger";
    case "sale_paid": return "success";
    // task_assigned: o payload de push não carrega a severidade (warning só
    // pra prioridade alta/crítica) — isso é decidido no evento persistido,
    // visível na Central. Aqui, no toast, fica sempre "info" por simplicidade.
    case "task_assigned": return "info";
    default: return "info";
  }
}

function Icone({ type }: { type: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (type) {
    case "sale_high_value":
      return <svg {...common}><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>;
    case "sale_low_margin":
    case "sale_negative_margin":
      return <svg {...common}><path d="M3 20h18" /><path d="M6 20V10M12 20V4M18 20v-7" /><circle cx="18" cy="8" r="1.4" fill="currentColor" stroke="none" /></svg>;
    case "sale_cancelled":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>;
    case "return_opened":
    case "return_completed":
      return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>;
    case "task_assigned":
      return <svg {...common}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>;
    case "sale_paid":
    default:
      return <svg {...common}><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /><path d="M9.5 12.5l1.8 1.8L15 11" /></svg>;
  }
}

function fmtBRL(v: string | undefined): string | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function SaleNotificationToast({
  event,
  onClose,
  onNavigate,
}: {
  event: ForegroundPushEvent;
  onClose: () => void;
  onNavigate: (deepLink: string) => void;
}) {
  const tone = toneDeTipo(event.type);
  // role="alert" interrompe leitor de tela na hora (prejuízo/cancelamento —
  // o usuário precisa saber já); venda normal usa "status", que só anuncia
  // na próxima pausa natural, sem atropelar o que a pessoa estava lendo.
  const role = tone === "danger" ? "alert" : "status";
  const grossFmt = fmtBRL(event.grossAmount);
  const lucroFmt = fmtBRL(event.estimatedProfit);
  const emAtualizacao = event.financialState === "unavailable" || (event.estimatedProfit == null && event.type !== "sale_cancelled" && event.type !== "return_completed");
  const itens = parseItens(event.itensJson);
  const [expandido, setExpandido] = useState(false);

  return (
    <div className={`sale-toast sale-toast-${tone}`} role={role} aria-live={tone === "danger" ? "assertive" : "polite"}>
      <div className="sale-toast-head">
        <span className="sale-toast-icon"><Icone type={event.type} /></span>
        <span className="sale-toast-title">{event.title}</span>
        <button type="button" className="sale-toast-close" onClick={onClose} aria-label="Fechar notificação">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      {event.productName && <div className="sale-toast-product">{event.productName}</div>}
      {event.orderId && <div className="sale-toast-sub">Pedido #{event.orderId}</div>}

      {itens.length > 1 && (
        <>
          <button
            type="button"
            className="sale-toast-expand-btn"
            onClick={() => setExpandido((v) => !v)}
            aria-expanded={expandido}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: expandido ? "rotate(90deg)" : "none", transition: "transform .15s" }}><path d="M9 6l6 6-6 6" /></svg>
            {expandido ? "Ocultar itens" : `Ver ${itens.length} itens`}
          </button>
          {expandido && (
            <ul className="sale-toast-itens">
              {itens.map((it, i) => (
                <li key={i}>
                  <span>{it.title}</span>
                  <span className="tabular-nums">{it.quantity > 1 ? `×${it.quantity}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {grossFmt && <div className="sale-toast-value tabular-nums">{grossFmt}</div>}

      {emAtualizacao ? (
        <span className="sale-toast-updating">Resultado financeiro em atualização</span>
      ) : (
        lucroFmt && (
          <div className="sale-toast-finance tabular-nums">
            Lucro est.: {lucroFmt}
            {event.estimatedMargin && ` · Margem: ${event.estimatedMargin}%`}
          </div>
        )
      )}

      {event.orderId && (
        <div className="sale-toast-actions">
          <button type="button" className="btn btn-primary btn-xs" onClick={() => onNavigate(event.deepLink)}>Ver pedido</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onNavigate("/")}>Ver dashboard</button>
        </div>
      )}
    </div>
  );
}
