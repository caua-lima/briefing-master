"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { authedFetch } from "@/lib/api/authed-fetch";
import { disablePushNotifications, enablePushNotifications, getPushStatus } from "@/lib/firebase/push";

/**
 * Botão de sino na barra superior pra ligar/desligar notificação de venda
 * neste dispositivo. Tem um indicador visual sempre visível (a bolinha no
 * canto do sino) porque o rótulo de texto some no celular pra não estourar
 * a barra — sem a bolinha, não sobraria nenhum jeito de ver o estado lá.
 */
export function PushNotificationToggle() {
  const { user } = useAuth();
  const [status, setStatus] = useState<"unsupported" | "off" | "on" | "denied" | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [teste, setTeste] = useState<"idle" | "enviando" | "enviado" | "erro" | "sem-dispositivo">("idle");

  useEffect(() => {
    getPushStatus().then(setStatus);
  }, []);

  async function toggle() {
    if (!user?.email || busy) return;
    setBusy(true);
    setError("");
    setTeste("idle");
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
   * O status "ativo" acima é só local (permissão do navegador + uma flag
   * salva) — não prova que o pipeline inteiro funciona (token salvo no
   * Firestore → FCM aceita → o aparelho de fato mostra o aviso). Este botão
   * dispara uma notificação de verdade só pra você, sem esperar a próxima venda.
   */
  async function enviarTeste(e: React.MouseEvent) {
    e.stopPropagation();
    if (teste === "enviando") return;
    setTeste("enviando");
    try {
      const res = await authedFetch("/api/push/test", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) { setTeste("erro"); return; }
      setTeste(json.enviados > 0 ? "enviado" : "sem-dispositivo");
    } catch {
      setTeste("erro");
    } finally {
      setTimeout(() => setTeste("idle"), 5000);
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
            onClick={enviarTeste}
            disabled={teste === "enviando"}
            title="Manda uma notificação de teste real pra este aparelho — prova que está funcionando de ponta a ponta."
          >
            {teste === "enviando" ? "Enviando…" : "Testar"}
          </button>
          {teste !== "idle" && teste !== "enviando" && (
            <div
              style={{
                position: "absolute", top: "100%", right: 0, marginTop: 6, fontSize: ".68rem",
                width: 210, textAlign: "right", background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 6, padding: "6px 8px", zIndex: 20,
                color: teste === "enviado" ? "var(--green)" : teste === "sem-dispositivo" ? "var(--yellow)" : "var(--red)",
              }}
            >
              {teste === "enviado" && "Enviada — chegou no seu aparelho?"}
              {teste === "sem-dispositivo" && "Nenhum dispositivo seu está registrado ainda."}
              {teste === "erro" && "Falha ao enviar o teste."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
