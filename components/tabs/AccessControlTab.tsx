"use client";

import { useEffect, useMemo, useState } from "react";
import { licencaValida, type AccessEntry } from "@/lib/domain/types";
import {
  addAccessEntry,
  removeAccessEntry,
  updateAccessEntry,
  watchAccessList,
  liberarAcesso,
  suspenderAcesso,
  reativarAcesso,
} from "@/lib/firebase/data";
import type { UserData } from "@/components/useUserData";
import { authedFetch } from "@/lib/api/authed-fetch";
import { useAccess } from "@/components/tabs/AccessGuard";

export default function AccessControlTab({
  uid,
  data,
}: {
  uid: string;
  data: UserData;
}) {
  void uid;
  void data;
  const { canEdit } = useAccess();

  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccessEntry["role"]>("user");
  const [displayName, setDisplayName] = useState("");
  const [photoURL, setPhotoURL] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const unsubscribe = watchAccessList((nextEntries) => {
      setEntries(nextEntries);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter((entry) => {
      return (
        entry.email.toLowerCase().includes(term) ||
        entry.role.toLowerCase().includes(term) ||
        (entry.displayName ?? "").toLowerCase().includes(term)
      );
    });
  }, [entries, search]);

  const editingEntry = useMemo(
    () => entries.find((entry) => entry.email === editingEmail) ?? null,
    [entries, editingEmail],
  );

  function resetForm() {
    setEditingEmail(null);
    setEmail("");
    setRole("user");
    setDisplayName("");
    setPhotoURL("");
    setPassword("");
    setError("");
  }

  function startEdit(entry: AccessEntry) {
    setEditingEmail(entry.email);
    setEmail(entry.email);
    setRole(entry.role);
    setDisplayName(entry.displayName ?? "");
    setPhotoURL(entry.photoURL ?? "");
    setPassword("");
    setError("");
  }

  async function saveEntry() {
    if (!canEdit) { setError("Somente o owner pode alterar acessos."); return; }
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Informe um e-mail válido.");
      return;
    }
    if (password && password.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    try {
      setError("");
      const effectiveRole = editingEntry?.role === "owner" ? "owner" : role;
      const payload: AccessEntry = {
        email: normalizedEmail,
        role: effectiveRole,
        displayName: displayName.trim() || undefined,
        photoURL: photoURL.trim() || undefined,
      };

      if (editingEmail) {
        if (editingEmail !== normalizedEmail) {
          await removeAccessEntry(editingEmail);
        }
        await updateAccessEntry(normalizedEmail, payload);
      } else {
        await addAccessEntry(payload);
      }

      // Se informou senha, cria/atualiza o login por e-mail/senha
      if (password) {
        const res = await authedFetch("/api/admin/create-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: normalizedEmail, password }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          setError("Acesso salvo, mas falhou criar o login: " + (j?.error ?? res.status));
          return;
        }
      }

      resetForm();
    } catch {
      setError("Não foi possível salvar a entrada de acesso.");
    }
  }

  async function deleteEntry(entryEmail: string) {
    if (!canEdit) return;
    const target = entries.find((entry) => entry.email === entryEmail) ?? null;
    if (target?.role === "owner") {
      setError("Owner não pode ser removido.");
      return;
    }

    if (!confirm(`Remover acesso de ${entryEmail}?`)) return;

    try {
      await removeAccessEntry(entryEmail);
      if (editingEmail === entryEmail) {
        resetForm();
      }
    } catch {
      setError("Não foi possível remover a entrada.");
    }
  }

  const owners = entries.filter((e) => e.role === "owner").length;
  const roleBadge = (r: AccessEntry["role"]) => {
    const map: Record<string, [string, string]> = { owner: ["Owner", "#a855f7"], admin: ["Legado", "#64748b"], user: ["Usuário", "#64748b"] };
    const [txt, cor] = map[r] ?? map.user;
    return <span style={{ fontSize: ".7rem", fontWeight: 700, color: cor, background: `${cor}1f`, border: `1px solid ${cor}`, borderRadius: 6, padding: "1px 8px" }}>{txt}</span>;
  };

  // Resumo das licenças (o dono precisa ver quem vence antes de vencer)
  const agora = Date.now();
  const DIA = 86400000;
  const ativas = entries.filter((e) => licencaValida(e, agora).ok).length;
  const vencendo = entries.filter(
    (e) => licencaValida(e, agora).ok && e.expiresAt != null && e.expiresAt - agora < 7 * DIA,
  ).length;
  const inativas = entries.length - ativas;

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-left"><h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>Controle de Acesso</h2></div>
      </div>

      <div className="kpi-grid">
        <div className="kpi k-acc"><div className="k-lbl">Acessos</div><div className="k-val">{entries.length}</div></div>
        <div className="kpi k-pos"><div className="k-lbl">Licenças ativas</div><div className="k-val" style={{ color: "var(--green)" }}>{ativas}</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Vencendo em 7 dias</div><div className="k-val" style={{ color: "var(--yellow)" }}>{vencendo}</div></div>
        <div className="kpi k-neg"><div className="k-lbl">Vencidas / suspensas</div><div className="k-val" style={{ color: "var(--red)" }}>{inativas}</div></div>
      </div>

      <PainelLicencas entries={entries} />


      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
        <div className="panel">
          <div className="panel-head" style={{ marginBottom: 4 }}>
            <span className="panel-title">{editingEmail ? "Editar acesso" : "＋ Nova entrada"}</span>
            {editingEmail ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>Cancelar edição</button>
            ) : null}
          </div>
          <div style={{ fontSize: ".78rem", color: "var(--muted)", marginBottom: 14 }}>
            Autorize por e-mail. A pessoa entra por Google ou, se definir uma senha, por e-mail/senha.
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div className="config-field" style={{ margin: 0 }}>
              <label>E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@empresa.com"
                disabled={!!editingEmail}
              />
            </div>

            <div className="config-field" style={{ margin: 0 }}>
              <label>Nome de exibição</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Nome opcional"
              />
            </div>

            <div className="config-field" style={{ margin: 0 }}>
              <label>Senha de login (opcional)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Deixe em branco para só Google · mín. 6 caracteres"
                autoComplete="new-password"
              />
              <div className="hint">
                Preenchendo, cria um login por e-mail/senha (além do Google). Reeditar troca a senha.
              </div>
            </div>

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
              <div className="config-field" style={{ margin: 0 }}>
                <label>Perfil</label>
                <select
                  value={editingEntry?.role === "owner" ? "owner" : role}
                  onChange={(e) => setRole(e.target.value as AccessEntry["role"]) }
                  disabled={editingEntry?.role === "owner"}
                >
                  <option value="owner">Owner (acesso total)</option>
                  <option value="user">Usuário (somente leitura)</option>
                </select>
              </div>

              <div className="config-field" style={{ margin: 0 }}>
                <label>Foto URL</label>
                <input
                  type="url"
                  value={photoURL}
                  onChange={(e) => setPhotoURL(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>

            {error ? (
              <div style={{ color: "#ef4444", fontSize: ".85rem" }}>{error}</div>
            ) : null}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-success" onClick={saveEntry} disabled={!canEdit} style={{ opacity: canEdit ? 1 : 0.5 }}>
                {editingEmail ? "Salvar alterações" : "＋ Adicionar e-mail"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={resetForm}>Limpar</button>
              {!canEdit && <span style={{ fontSize: ".78rem", color: "var(--muted)", alignSelf: "center" }}>somente leitura</span>}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">E-mails autorizados <span className="panel-sub">· {loading ? "…" : `${filteredEntries.length} registro(s)`}</span></span>
            <input
              type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar por e-mail ou nome"
              style={{ maxWidth: 260, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 12px", color: "var(--text)", fontSize: ".85rem", outline: "none" }}
            />
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {loading ? (
              <div style={{ color: "var(--muted)", fontSize: ".9rem" }}>Carregando…</div>
            ) : filteredEntries.length ? (
              filteredEntries.map((entry) => (
                <div key={entry.email} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "12px 14px", borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700 }}>{entry.email}</span>
                      {roleBadge(entry.role)}
                    </div>
                    <div style={{ marginTop: 4, fontSize: ".8rem", color: "var(--muted)" }}>
                      {entry.displayName || "Sem nome"}
                      {entry.addedAt ? ` · desde ${new Date(entry.addedAt).toLocaleDateString("pt-BR")}` : ""}
                    </div>
                  </div>
                  {canEdit && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-warning btn-xs" onClick={() => startEdit(entry)}>Editar</button>
                      <button type="button" className="btn btn-danger btn-xs" onClick={() => deleteEntry(entry.email)} disabled={entry.role === "owner"}>Remover</button>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div style={{ color: "var(--muted)", fontSize: ".9rem", textAlign: "center", padding: 20 }}>Nenhum e-mail encontrado.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Painel de licenças (admin master) ─────────────────────────────
/**
 * Onde o dono libera acesso depois de fechar a venda na call. O pagamento
 * acontece fora do sistema — aqui só se registra por quanto tempo vale.
 */
function PainelLicencas({ entries }: { entries: AccessEntry[] }) {
  const [email, setEmail] = useState("");
  const [meses, setMeses] = useState(12);
  const [nota, setNota] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const DIA = 86400000;
  const fmtData = (ms?: number | null) =>
    ms ? new Date(ms).toLocaleDateString("pt-BR") : "sem prazo";

  async function liberar() {
    const alvo = email.trim().toLowerCase();
    if (!alvo || !alvo.includes("@")) {
      setMsg({ tipo: "erro", texto: "Informe um e-mail válido." });
      return;
    }
    setSalvando(true);
    try {
      const ate = await liberarAcesso(alvo, meses, nota.trim() || undefined);
      setMsg({ tipo: "ok", texto: `Acesso de ${alvo} liberado até ${fmtData(ate)}.` });
      setEmail("");
      setNota("");
    } catch (e) {
      setMsg({ tipo: "erro", texto: "Erro ao liberar: " + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setSalvando(false);
    }
  }

  // Só quem tem prazo definido é "cliente"; o dono não tem.
  const clientes = entries
    .filter((e) => e.expiresAt != null || e.status === "suspenso")
    .sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0));

  return (
    <div className="panel">
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <span className="panel-title">Liberar acesso</span>
        <span className="panel-sub">o pagamento é fora do sistema — aqui só o prazo</span>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 6 }}>
        <div className="config-field" style={{ margin: 0, flex: "2 1 220px" }}>
          <label>E-mail do cliente</label>
          <input type="email" value={email} placeholder="cliente@gmail.com"
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="config-field" style={{ margin: 0, flex: "1 1 120px" }}>
          <label>Período</label>
          <select value={meses} onChange={(e) => setMeses(Number(e.target.value))}>
            <option value={1}>1 mês</option>
            <option value={3}>3 meses</option>
            <option value={6}>6 meses</option>
            <option value={12}>12 meses (anual)</option>
          </select>
        </div>
        <div className="config-field" style={{ margin: 0, flex: "2 1 200px" }}>
          <label>Anotação (opcional)</label>
          <input type="text" value={nota} placeholder="fechou na call, R$40/mês"
            onChange={(e) => setNota(e.target.value)} />
        </div>
        <button type="button" className="btn btn-success btn-sm" onClick={liberar} disabled={salvando}>
          {salvando ? "Liberando…" : "Liberar acesso"}
        </button>
      </div>

      <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: 12 }}>
        Renovar antes do vencimento <b>soma</b> ao prazo restante — o cliente não perde os dias que sobraram.
      </div>

      {msg && (
        <div style={{
          padding: "8px 12px", borderRadius: 8, fontSize: ".78rem", marginBottom: 12,
          background: msg.tipo === "ok" ? "rgba(34,197,94,.12)" : "rgba(239,68,68,.1)",
          border: `1px solid ${msg.tipo === "ok" ? "var(--green)" : "var(--red)"}`,
          color: msg.tipo === "ok" ? "var(--green)" : "var(--red)",
        }}>{msg.texto}</div>
      )}

      {clientes.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: ".82rem", padding: "8px 0" }}>
          Nenhum cliente com licença ainda. Libere o primeiro acima.
        </div>
      ) : (
        <div className="table-wrapper" style={{ border: "none" }}>
          <table className="tbl-modern">
            <thead><tr>
              <th style={{ textAlign: "left" }}>Cliente</th>
              <th>Situação</th>
              <th style={{ textAlign: "right" }}>Vence em</th>
              <th style={{ textAlign: "right" }}>Ações</th>
            </tr></thead>
            <tbody>
              {clientes.map((c) => {
                const lic = licencaValida(c);
                const dias = c.expiresAt ? Math.ceil((c.expiresAt - Date.now()) / DIA) : null;
                const cor = !lic.ok ? "var(--red)" : dias != null && dias <= 7 ? "#f7c948" : "var(--green)";
                const rotulo = !lic.ok
                  ? (lic.motivo === "expirada" ? "Vencida" : lic.motivo === "suspensa" ? "Suspensa" : "Sem licença")
                  : dias != null ? `Ativa · ${dias}d` : "Ativa";
                return (
                  <tr key={c.email}>
                    <td style={{ textAlign: "left" }}>
                      <div style={{ fontWeight: 600 }}>{c.email}</div>
                      {c.nota && <div style={{ fontSize: ".68rem", color: "var(--muted)" }}>{c.nota}</div>}
                    </td>
                    <td><span style={{ color: cor, fontWeight: 700, fontSize: ".76rem" }}>{rotulo}</span></td>
                    <td style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtData(c.expiresAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button type="button" className="btn btn-ghost btn-xs"
                          onClick={() => liberarAcesso(c.email, 12).catch(() => {})}>+12 meses</button>
                        {c.status === "suspenso" ? (
                          <button type="button" className="btn btn-success btn-xs"
                            onClick={() => reativarAcesso(c.email).catch(() => {})}>Reativar</button>
                        ) : (
                          <button type="button" className="btn btn-danger btn-xs"
                            onClick={() => { if (confirm(`Suspender o acesso de ${c.email}?`)) suspenderAcesso(c.email).catch(() => {}); }}>Suspender</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
