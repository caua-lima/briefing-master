"use client";

import { useEffect, useState } from "react";
import { SUGESTAO_STATUS, type Sugestao, type SugestaoStatus } from "@/lib/domain/types";
import {
  enviarSugestao,
  watchMinhasSugestoes,
  watchTodasSugestoes,
  responderSugestao,
  excluirSugestao,
} from "@/lib/firebase/data";
import { useAccess } from "@/components/tabs/AccessGuard";

/**
 * Canal de sugestões. Uma tela só, dois papéis:
 * - cliente: envia ideias/problemas e acompanha o que virou o quê
 * - dono (owner): vê tudo, responde e move o status
 */
export default function SugestoesTab() {
  const { isOwner, email } = useAccess();
  const [lista, setLista] = useState<Sugestao[]>([]);
  const [texto, setTexto] = useState("");
  const [categoria, setCategoria] = useState<Sugestao["categoria"]>("ideia");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | SugestaoStatus>("todas");

  useEffect(() => {
    // O dono enxerga tudo; o cliente só as próprias (a consulta filtra por
    // e-mail, que é o que as regras do Firestore exigem).
    const un = isOwner ? watchTodasSugestoes(setLista) : watchMinhasSugestoes(setLista);
    return () => un();
  }, [isOwner]);

  async function enviar() {
    const t = texto.trim();
    if (t.length < 10) {
      setMsg("Escreva um pouco mais para eu entender bem a ideia (mín. 10 caracteres).");
      return;
    }
    setEnviando(true);
    try {
      await enviarSugestao(t, categoria);
      setTexto("");
      setMsg("Enviado! Obrigado — vou analisar e você acompanha o status aqui.");
    } catch (e) {
      setMsg("Não consegui enviar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setEnviando(false);
    }
  }

  const visiveis = filtro === "todas" ? lista : lista.filter((s) => s.status === filtro);
  const contar = (st: SugestaoStatus) => lista.filter((s) => s.status === st).length;
  const fmtData = (ms: number) =>
    new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>Sugestões</h2>
        </div>
      </div>

      {/* Envio — todo mundo pode sugerir, inclusive o dono */}
      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 6 }}>
          <span className="panel-title">Tem uma ideia?</span>
          <span className="panel-sub">o que te ajudaria a vender mais ou economizar tempo</span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {([
            ["ideia", "Ideia nova", "var(--accent)"],
            ["problema", "Algo com problema", "var(--red)"],
            ["outro", "Outro", "var(--muted)"],
          ] as const).map(([id, label, cor]) => (
            <button
              key={id}
              type="button"
              onClick={() => setCategoria(id)}
              style={{
                fontSize: ".78rem", fontWeight: 600, padding: "6px 14px", borderRadius: 20,
                cursor: "pointer",
                background: categoria === id ? cor : "var(--surface2)",
                color: categoria === id ? "#fff" : "var(--muted)",
                border: `1px solid ${categoria === id ? cor : "var(--border)"}`,
              }}
            >{label}</button>
          ))}
        </div>

        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={4}
          placeholder="Ex.: seria útil ver o lucro por marca, não só por anúncio…"
          style={{
            width: "100%", background: "var(--surface2)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "10px 12px", color: "var(--text)", fontSize: ".9rem",
            outline: "none", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit",
          }}
        />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>
            {isOwner ? "Você também pode registrar ideias suas aqui." : "Sua sugestão vai direto para quem desenvolve o sistema."}
          </span>
          <button type="button" className="btn btn-success btn-sm" onClick={enviar} disabled={enviando}>
            {enviando ? "Enviando…" : "Enviar sugestão"}
          </button>
        </div>

        {msg && (
          <div style={{
            marginTop: 10, padding: "8px 12px", borderRadius: 8, fontSize: ".78rem",
            background: "rgba(79,142,247,.1)", border: "1px solid rgba(79,142,247,.3)", color: "var(--text)",
          }}>{msg}</div>
        )}
      </div>

      {/* Lista */}
      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 10 }}>
          <span className="panel-title">{isOwner ? "Tudo que chegou" : "Suas sugestões"}</span>
          <span className="panel-sub">{lista.length} no total</span>
        </div>

        {lista.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {(["todas", "nova", "analisando", "aceita", "entregue", "recusada"] as const).map((f) => {
              const ativo = filtro === f;
              const cor = f === "todas" ? "var(--accent)" : SUGESTAO_STATUS[f].cor;
              const n = f === "todas" ? lista.length : contar(f);
              if (f !== "todas" && n === 0) return null;
              return (
                <button key={f} type="button" onClick={() => setFiltro(f)}
                  style={{
                    fontSize: ".74rem", fontWeight: 600, padding: "4px 11px", borderRadius: 20, cursor: "pointer",
                    background: ativo ? cor : "var(--surface2)", color: ativo ? "#fff" : "var(--muted)",
                    border: `1px solid ${ativo ? cor : "var(--border)"}`,
                  }}>
                  {f === "todas" ? "Todas" : SUGESTAO_STATUS[f].label} ({n})
                </button>
              );
            })}
          </div>
        )}

        {visiveis.length === 0 ? (
          <div style={{ textAlign: "center", padding: 32, color: "var(--muted)", fontSize: ".85rem" }}>
            {lista.length === 0
              ? "Nenhuma sugestão ainda. Manda a primeira aí em cima."
              : "Nenhuma sugestão nesse filtro."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visiveis.map((s) => (
              <CardSugestao key={s.id} s={s} isOwner={isOwner} meuEmail={email} fmtData={fmtData} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CardSugestao({
  s, isOwner, meuEmail, fmtData,
}: {
  s: Sugestao;
  isOwner: boolean;
  meuEmail: string;
  fmtData: (ms: number) => string;
}) {
  const [resposta, setResposta] = useState(s.resposta ?? "");
  const [abrindo, setAbrindo] = useState(false);
  const st = SUGESTAO_STATUS[s.status] ?? SUGESTAO_STATUS.nova;

  return (
    <div style={{
      background: "var(--surface2)", border: "1px solid var(--border)",
      borderLeft: `3px solid ${st.cor}`, borderRadius: 10, padding: "12px 14px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
          <span style={{
            fontSize: ".68rem", fontWeight: 700, color: st.cor, background: `${st.cor}1f`,
            border: `1px solid ${st.cor}`, borderRadius: 6, padding: "1px 8px",
          }}>{st.label}</span>
          <span style={{ fontSize: ".68rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
            {s.categoria === "problema" ? "problema" : s.categoria === "ideia" ? "ideia" : "outro"}
          </span>
          {/* o dono precisa saber de quem veio; o cliente já sabe */}
          {isOwner && s.email !== meuEmail && (
            <span style={{ fontSize: ".7rem", color: "var(--muted)" }}>· {s.email}</span>
          )}
        </div>
        <span style={{ fontSize: ".7rem", color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtData(s.criadoEm)}</span>
      </div>

      <div style={{ fontSize: ".88rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{s.texto}</div>

      {s.resposta && (
        <div style={{
          marginTop: 10, padding: "8px 12px", borderRadius: 8,
          background: "rgba(79,142,247,.08)", border: "1px solid rgba(79,142,247,.25)",
        }}>
          <div style={{ fontSize: ".66rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 3 }}>
            Resposta
          </div>
          <div style={{ fontSize: ".82rem", lineHeight: 1.5 }}>{s.resposta}</div>
        </div>
      )}

      {isOwner && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          {!abrindo ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["analisando", "aceita", "entregue", "recusada"] as const).map((novo) => (
                <button key={novo} type="button" className="btn btn-ghost btn-xs"
                  onClick={() => responderSugestao(s.id, { status: novo }).catch(() => {})}
                  style={{ opacity: s.status === novo ? 1 : 0.75, fontWeight: s.status === novo ? 700 : 500 }}>
                  {SUGESTAO_STATUS[novo].label}
                </button>
              ))}
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAbrindo(true)}>
                {s.resposta ? "Editar resposta" : "Responder"}
              </button>
              <button type="button" className="btn btn-danger btn-xs"
                onClick={() => { if (confirm("Excluir esta sugestão?")) excluirSugestao(s.id).catch(() => {}); }}>
                Excluir
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <textarea value={resposta} onChange={(e) => setResposta(e.target.value)} rows={2}
                placeholder="Resposta para o cliente…"
                style={{
                  flex: "1 1 240px", background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: ".82rem",
                  outline: "none", resize: "vertical", fontFamily: "inherit",
                }} />
              <button type="button" className="btn btn-success btn-xs"
                onClick={async () => { await responderSugestao(s.id, { resposta: resposta.trim() }); setAbrindo(false); }}>
                Salvar
              </button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAbrindo(false)}>Cancelar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
