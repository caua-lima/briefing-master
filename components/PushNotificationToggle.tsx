"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { authedFetch } from "@/lib/api/authed-fetch";
import { disablePushNotifications, enablePushNotifications, getPushStatus } from "@/lib/firebase/push";
import NotificationSettings from "@/components/NotificationSettings";

const CENARIOS: { id: string; label: string }[] = [
  { id: "sale_paid", label: "Venda padrão" },
  { id: "sale_high_value", label: "Venda de alto valor" },
  { id: "sale_low_margin", label: "Venda com margem baixa" },
  { id: "sale_negative_margin", label: "Venda com prejuízo" },
  { id: "sale_cancelled", label: "Cancelamento" },
  { id: "return_completed", label: "Devolução concluída" },
  { id: "sales_summary", label: "Resumo agrupado" },
  { id: "unavailable", label: "Dados financeiros indisponíveis" },
];

type ResultadoTeste = {
  ok: boolean;
  scenario: string;
  title?: string; body?: string; enviados?: number; horario?: string;
  bloqueioMotivo?: string | null; error?: string;
};

/**
 * Botão de sino na barra superior pra ligar/desligar notificação de venda
 * neste dispositivo, mais o menu de cenários de teste e o atalho pra
 * configurações. Tem um indicador visual sempre visível (a bolinha no canto
 * do sino) porque o rótulo de texto some no celular pra não estourar a
 * barra — sem a bolinha, não sobraria nenhum jeito de ver o estado lá.
 */
export function PushNotificationToggle() {
  const { user } = useAuth();
  const [status, setStatus] = useState<"unsupported" | "off" | "on" | "denied" | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menuAberto, setMenuAberto] = useState(false);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoTeste | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    getPushStatus().then(setStatus);
  }, []);

  async function toggle() {
    if (!user?.email || busy) return;
    setBusy(true);
    setError("");
    setResultado(null);
    try {
      if (status === "on") {
        await disablePushNotifications(user.email.toLowerCase());
        setStatus("off");
      } else {
        const res = await enablePushNotifications(user.email.toLowerCase());
        if (res.ok) {
          setStatus("on");
        } else {
          setError(res.error);
          setStatus(await getPushStatus());
        }
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Dispara um cenário de teste real (evento + push, só pro seu aparelho) —
   * prova que o pipeline inteiro funciona (token salvo → FCM aceita →
   * aparelho mostra o aviso) sem esperar a próxima venda de verdade. Mostra
   * em tela exatamente o que a Fase 7 pediu: evento criado, quantos
   * dispositivos, se enviou ou por que não.
   */
  async function testarCenario(scenario: string) {
    if (enviando) return;
    setEnviando(scenario);
    setMenuAberto(false);
    try {
      const res = await authedFetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      const json = (await res.json().catch(() => null)) as ResultadoTeste | null;
      setResultado(json ?? { ok: false, scenario, error: "Resposta inválida" });
    } catch (err) {
      setResultado({ ok: false, scenario, error: err instanceof Error ? err.message : "Falha ao enviar" });
    } finally {
      setEnviando(null);
      setTimeout(() => setResultado(null), 12000);
    }
  }

  if (status === "unsupported" || status === "loading") return null;

  const icone = status === "denied" ? "🔕" : "🔔";
  const texto = status === "on" ? "Notificações ativas" : status === "denied" ? "Bloqueado" : "Ativar notificações";
  const title = status === "denied"
    ? "Notificações bloqueadas nas configurações do navegador/site — libere lá antes de tentar de novo."
    : status === "on"
      ? "Você recebe uma notificação neste dispositivo a cada venda nova. Clique pra desativar."
      : "Ativa notificação neste dispositivo toda vez que sair uma venda nova.";

  // Cor da bolinha: verde = ativo, vermelho = bloqueado, cinza = ainda não ativado.
  const corBolinha = status === "on" ? "var(--green)" : status === "denied" ? "var(--red)" : "var(--muted)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={toggle}
          disabled={busy || status === "denied"}
          title={title}
          aria-label={`${texto} — clique pra ${status === "on" ? "desativar" : "ativar"}`}
        >
          {busy ? "…" : (
            <>
              <span style={{ position: "relative", display: "inline-flex" }}>
                <span aria-hidden>{icone}</span>
                {/* Indicador sempre visível — sobrevive ao rótulo de texto
                    sumindo no celular (.push-label, ver globals.css). */}
                <span
                  aria-hidden
                  style={{
                    position: "absolute", bottom: -2, right: -2, width: 7, height: 7,
                    borderRadius: "50%", background: corBolinha, border: "1.5px solid var(--surface)",
                  }}
                />
              </span>
              <span className="push-label">{texto}</span>
            </>
          )}
        </button>
        {error && (
          <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, fontSize: ".68rem", color: "var(--red)", width: 220, textAlign: "right", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", zIndex: 20 }}>
            {error}
          </div>
        )}
      </div>

      {status === "on" && (
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setMenuAberto((v) => !v)}
            disabled={!!enviando}
            title="Testa um cenário de notificação real neste aparelho, sem usar dado de venda de verdade."
            aria-expanded={menuAberto}
          >
            {enviando ? "Enviando…" : "Testar ▾"}
          </button>

          {menuAberto && (
            <div
              role="menu"
              style={{
                position: "absolute", top: "100%", right: 0, marginTop: 6, width: 240,
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
                boxShadow: "var(--shadow)", zIndex: 30, overflow: "hidden",
              }}
            >
              {CENARIOS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="menuitem"
                  onClick={() => testarCenario(c.id)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                    background: "transparent", border: "none", color: "var(--text)", fontSize: ".82rem", cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface2)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {resultado && (
            <div
              style={{
                position: "absolute", top: "100%", right: 0, marginTop: 6, fontSize: ".72rem",
                width: 260, textAlign: "left", background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "10px 12px", zIndex: 20, lineHeight: 1.5,
              }}
            >
              {resultado.ok ? (
                <>
                  <div style={{ fontWeight: 700, color: "var(--green)" }}>Evento criado</div>
                  <div style={{ color: "var(--muted)" }}>{resultado.title}</div>
                  <div style={{ marginTop: 4 }}>
                    {resultado.enviados && resultado.enviados > 0
                      ? <span style={{ color: "var(--green)" }}>Push enviado a {resultado.enviados} dispositivo(s)</span>
                      : <span style={{ color: "var(--yellow)" }}>{resultado.bloqueioMotivo || "Nenhum dispositivo recebeu"}</span>}
                  </div>
                  {resultado.horario && <div style={{ color: "var(--muted)", marginTop: 2 }}>{new Date(resultado.horario).toLocaleTimeString("pt-BR")}</div>}
                  <div style={{ color: "var(--muted)", marginTop: 4, fontStyle: "italic" }}>Se o app estiver em foreground, o toast deve ter aparecido no canto da tela.</div>
                </>
              ) : (
                <div style={{ color: "var(--red)" }}>Falha ao enviar: {resultado.error}</div>
              )}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="btn btn-ghost btn-xs"
        onClick={() => setSettingsOpen(true)}
        aria-label="Configurações de notificação"
        title="Configurações de notificação"
      >
        ⚙
      </button>

      <NotificationSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
