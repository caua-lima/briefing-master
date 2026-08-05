"use client";

import { useEffect, useState } from "react";
import { useAccess } from "@/components/tabs/AccessGuard";
import { dismissAlert, watchDismissedAlerts } from "@/lib/firebase/data";
import {
  alertShouldReappear,
  buildActionAlerts,
  type ActionAlert,
  type AlertSeverity,
  type BuildAlertsInput,
} from "@/lib/domain/alerts";

const SEVERITY_META: Record<AlertSeverity, { label: string; icon: string; cls: string }> = {
  critical: { label: "Crítico", icon: "▾", cls: "severity-critical" },
  warning: { label: "Alerta", icon: "!", cls: "severity-warning" },
  opportunity: { label: "Oportunidade", icon: "↑", cls: "severity-opportunity" },
  success: { label: "Sucesso", icon: "✓", cls: "severity-success" },
  info: { label: "Info", icon: "i", cls: "severity-info" },
};

type Filtro = "todos" | "criticos" | "oportunidades";

export type ActionCenterProps = BuildAlertsInput & {
  onNavigate?: (tab: string) => void;
};

export default function ActionCenter(props: ActionCenterProps) {
  const { onNavigate, ...alertInput } = props;
  const { email } = useAccess();
  const [dismissed, setDismissed] = useState<Map<string, number>>(new Map());
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!email) return;
    return watchDismissedAlerts(email, (entries) => {
      setDismissed(new Map(entries.map((e) => [e.chave, e.valorRef])));
    });
  }, [email]);

  // Cálculo leve sobre arrays pequenos (anúncios/produtos do período) — não
  // vale a pena memoizar e complicar as deps por causa disso.
  const todosAlertas = buildActionAlerts(alertInput);

  const visiveis = todosAlertas.filter((a) => {
    const valorDispensado = dismissed.get(a.chave);
    if (valorDispensado == null) return true;
    return alertShouldReappear(a.valorRef, valorDispensado);
  });

  const filtrados = visiveis.filter((a) => {
    if (filtro === "criticos") return a.severity === "critical";
    if (filtro === "oportunidades") return a.severity === "opportunity";
    return true;
  });

  const top5 = filtrados.slice(0, 5);

  async function handleDismiss(a: ActionAlert) {
    if (!email) return;
    setDismissed((prev) => new Map(prev).set(a.chave, a.valorRef));
    try {
      await dismissAlert(email, a.chave, a.valorRef);
    } catch {
      // se a escrita falhar, o alerta volta no próximo snapshot do Firestore
    }
  }

  if (visiveis.length === 0) {
    return (
      <div className="ac-empty">
        Nenhum alerta agora — os números do período estão dentro do esperado.
      </div>
    );
  }

  return (
    <section className="ac-panel">
      <div className="ac-head">
        <div>
          <div className="ac-title">Central de Atenção</div>
          <div className="ac-sub">O que precisa da sua decisão agora</div>
        </div>
        <div className="ac-filters" role="tablist" aria-label="Filtrar alertas">
          {(["todos", "criticos", "oportunidades"] as const).map((f) => (
            <button
              key={f} type="button" role="tab" aria-selected={filtro === f}
              className={`ac-filter-btn ${filtro === f ? "active" : ""}`}
              onClick={() => setFiltro(f)}
            >
              {f === "todos" ? "Todos" : f === "criticos" ? "Críticos" : "Oportunidades"}
            </button>
          ))}
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="ac-empty">Nenhum alerta neste filtro.</div>
      ) : (
        <div className="ac-list">
          {top5.map((a) => (
            <AlertCard key={a.chave} alert={a} onDismiss={() => handleDismiss(a)} onNavigate={onNavigate} />
          ))}
        </div>
      )}

      {filtrados.length > 5 && (
        <button type="button" className="ac-see-all" onClick={() => setShowAll(true)}>
          Ver todos os alertas ({filtrados.length})
        </button>
      )}

      {showAll && (
        <div className="modal-overlay active" onClick={() => setShowAll(false)}>
          <div className="modal-box modal-box-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title" style={{ textAlign: "left" }}>Todos os alertas</div>
            <div className="ac-list" style={{ marginTop: 14 }}>
              {filtrados.map((a) => (
                <AlertCard key={a.chave} alert={a} onDismiss={() => handleDismiss(a)} onNavigate={onNavigate} />
              ))}
            </div>
            <div className="modal-btns">
              <button type="button" className="btn btn-ghost" onClick={() => setShowAll(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function AlertCard({
  alert, onDismiss, onNavigate,
}: {
  alert: ActionAlert;
  onDismiss: () => void;
  onNavigate?: (tab: string) => void;
}) {
  const meta = SEVERITY_META[alert.severity];
  return (
    <div className={`ac-card ac-card-${alert.severity}`}>
      <div className="ac-card-top">
        <span className={`severity-chip ${meta.cls}`}>
          <span aria-hidden="true">{meta.icon}</span> {meta.label}
        </span>
        <button type="button" className="ac-dismiss" onClick={onDismiss} aria-label={`Dispensar alerta: ${alert.titulo}`}>✕</button>
      </div>
      <div className="ac-card-title">{alert.titulo}</div>
      <div className="ac-card-explicacao">{alert.explicacao}</div>
      {alert.impacto != null && (
        <div className="ac-card-impacto money" style={{ color: alert.impacto >= 0 ? "var(--success)" : "var(--danger)" }}>
          Impacto estimado: {alert.impacto >= 0 ? "+" : "−"}
          {Math.abs(alert.impacto).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </div>
      )}
      {alert.ctaLabel && (
        <button
          type="button"
          className="ac-cta"
          onClick={() => alert.ctaTab && onNavigate?.(alert.ctaTab)}
          disabled={!alert.ctaTab || !onNavigate}
        >
          {alert.ctaLabel} →
        </button>
      )}
    </div>
  );
}
