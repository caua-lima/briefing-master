"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { authedFetch } from "@/lib/api/authed-fetch";
import { disablePushNotifications, enablePushNotifications, getPushStatus } from "@/lib/firebase/push";
import NotificationSettings from "@/components/NotificationSettings";
import Modal from "@/components/Modal";

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
 * Botão pra ligar/desligar notificação de venda NESTE dispositivo, mais um
 * menu único com os cenários de teste e o atalho pra configurações — os
 * dois viviam em botões separados, e somados ao sino da Central de
 * Notificações (componente irmão, no topbar) a barra ficava com dois ícones
 * de sino visualmente idênticos e sem espaço pra todo mundo no celular
 * (ver globals.css .topbar-actions). Reduzido pra 2 botões: o toggle em si
 * (ícone de aparelho, não de sino — não é a Central, é "neste dispositivo")
 * e um "⋯" que abre tanto o teste quanto as configurações.
 *
 * Tem um indicador visual sempre visível (a bolinha no canto do ícone)
 * porque o rótulo de texto some no celular pra não estourar a barra — sem a
 * bolinha, não sobraria nenhum jeito de ver o estado lá.
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
      // Sem auto-fechar: agora é um Modal de verdade (não a caixinha
      // flutuante de antes, que sumia sozinha em 12s e podia levar o usuário
      // a achar que "não apareceu nada" quando na real só piscou rápido
      // demais). Fecha só quando o usuário tocar em "Fechar".
    }
  }

  if (status === "unsupported" || status === "loading") return null;

  // 📱, não 🔔 — o sino já é o ícone da Central de Notificações (histórico
  // de vendas/alertas). Este botão é sobre ESTE aparelho especificamente;
  // usar o mesmo glifo dos dois lado a lado parecia um sino duplicado.
  const icone = status === "denied" ? "🔕" : "📱";
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

      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => setMenuAberto(true)}
          disabled={!!enviando}
          title="Testar notificação e configurações"
          aria-label="Mais ações de notificação"
          aria-expanded={menuAberto}
        >
          {enviando ? "…" : "⋯"}
        </button>
      </div>

      {/* Modal em vez de dropdown ancorado no botão: no celular, a barra de
          ações do topo tem overflow-x:auto (pra poder rolar quando não cabe
          tudo) — e por regra do CSS, definir overflow só num eixo faz o
          navegador cortar o outro eixo também (overflow-y vira "auto"
          escondido). O menu abria, mas ficava CORTADO pelo container,
          invisível mesmo estando no DOM. Modal usa position:fixed, que
          escapa desse corte. */}
      {menuAberto && (
        <Modal open onClose={() => setMenuAberto(false)}>
          <div className="modal-title">Notificações</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => testarCenario("sale_paid")}
              disabled={!!enviando}
              className="btn btn-warning"
              style={{ justifyContent: "flex-start" }}
            >
              {enviando === "sale_paid" ? "Enviando…" : "🔔 Testar agora"}
            </button>
            {status !== "on" && (
              <div style={{ fontSize: ".76rem", color: "var(--warning)", lineHeight: 1.4 }}>
                Este aparelho ainda não está com notificações ativas — o teste roda mesmo assim
                e mostra o motivo exato se não chegar.
              </div>
            )}

            <div style={{ fontSize: ".7rem", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted)", marginTop: 8 }}>
              Outros cenários
            </div>
            {CENARIOS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => testarCenario(c.id)}
                disabled={!!enviando}
                className="btn btn-ghost"
                style={{ justifyContent: "flex-start" }}
              >
                {enviando === c.id ? "Enviando…" : c.label}
              </button>
            ))}

            <hr className="config-sep" style={{ margin: "4px 0" }} />
            <button
              type="button"
              onClick={() => { setMenuAberto(false); setSettingsOpen(true); }}
              className="btn btn-ghost"
              style={{ justifyContent: "flex-start" }}
            >
              ⚙ Configurações
            </button>
          </div>
          <div className="modal-btns">
            <button type="button" className="btn btn-ghost" onClick={() => setMenuAberto(false)}>Fechar</button>
          </div>
        </Modal>
      )}

      {/* Modal em vez de caixinha flutuante perto do botão: no celular, com a
          barra de topo lotada, uma caixinha ancorada no botão facilmente saía
          da tela ou ficava atrás de outro elemento — resultado do teste
          parecia "não aparece nada" mesmo quando o servidor respondeu certo. */}
      {resultado && (
        <Modal open onClose={() => setResultado(null)}>
          <div className="modal-title">{resultado.ok ? "Teste de notificação" : "Falha no teste"}</div>
          {resultado.ok ? (
            <div style={{ fontSize: ".88rem", lineHeight: 1.6 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700 }}>{resultado.title}</div>
                <div style={{ color: "var(--muted)" }}>{resultado.body}</div>
              </div>
              <div style={{
                padding: "10px 12px", borderRadius: 8, marginBottom: 10,
                background: resultado.enviados && resultado.enviados > 0 ? "var(--success-soft,rgba(60,203,131,.12))" : "var(--warning-soft)",
                border: `1px solid ${resultado.enviados && resultado.enviados > 0 ? "rgba(60,203,131,.35)" : "rgba(255,138,31,.35)"}`,
                color: resultado.enviados && resultado.enviados > 0 ? "var(--success,var(--green))" : "var(--warning)",
                fontWeight: 600,
              }}>
                {resultado.enviados && resultado.enviados > 0
                  ? `Push enviado a ${resultado.enviados} dispositivo(s) registrado(s) neste e-mail.`
                  : (resultado.bloqueioMotivo || "Nenhum dispositivo seu está registrado pra receber.")}
              </div>
              {resultado.enviados && resultado.enviados > 0 ? (
                <div style={{ color: "var(--muted)", fontSize: ".82rem" }}>
                  O servidor confirmou o envio. Se mesmo assim não apareceu nada no celular em alguns
                  segundos, o problema está entre o Firebase e o sistema operacional — normalmente resolve
                  reinstalando o app (remova da tela inicial e adicione de novo) ou conferindo se a permissão
                  de notificação do site/app ainda está em &quot;Permitir&quot; nas configurações do aparelho.
                </div>
              ) : (
                <div style={{ color: "var(--muted)", fontSize: ".82rem" }}>
                  Toque no ícone 📱 pra ativar notificações neste aparelho — isso registra um token novo.
                  Depois repita o teste.
                </div>
              )}
              {resultado.horario && <div style={{ color: "var(--muted)", fontSize: ".76rem", marginTop: 8 }}>{new Date(resultado.horario).toLocaleTimeString("pt-BR")}</div>}
            </div>
          ) : (
            <div style={{ fontSize: ".88rem", color: "var(--red)", lineHeight: 1.6 }}>Falha ao enviar: {resultado.error}</div>
          )}
          <div className="modal-btns">
            <button type="button" className="btn btn-ghost" onClick={() => setResultado(null)}>Fechar</button>
          </div>
        </Modal>
      )}

      <NotificationSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
