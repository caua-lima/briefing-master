"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccessEntry } from "@/lib/domain/types";
import {
  addAccessEntry,
  removeAccessEntry,
  updateAccessEntry,
  watchAccessList,
} from "@/lib/firebase/data";
import type { UserData } from "@/components/useUserData";

export default function AccessControlTab({
  uid,
  data,
}: {
  uid: string;
  data: UserData;
}) {
  void uid;
  void data;

  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccessEntry["role"]>("user");
  const [displayName, setDisplayName] = useState("");
  const [photoURL, setPhotoURL] = useState("");

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
    setError("");
  }

  function startEdit(entry: AccessEntry) {
    setEditingEmail(entry.email);
    setEmail(entry.email);
    setRole(entry.role);
    setDisplayName(entry.displayName ?? "");
    setPhotoURL(entry.photoURL ?? "");
    setError("");
  }

  async function saveEntry() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Informe um e-mail válido.");
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

      resetForm();
    } catch {
      setError("Não foi possível salvar a entrada de acesso.");
    }
  }

  async function deleteEntry(entryEmail: string) {
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

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2>🔐 Controle de Acesso</h2>
          <div style={{ marginTop: 12, color: "var(--muted)" }}>
            Lista de e-mails autorizados com CRUD em tempo real.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>{editingEmail ? "Editar acesso" : "Nova entrada"}</h3>
              <div style={{ marginTop: 4, fontSize: ".84rem", color: "var(--muted)" }}>
                Controle direto da coleção /accessControl.
              </div>
            </div>
            {editingEmail ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>
                Cancelar edição
              </button>
            ) : null}
          </div>

          <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
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

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
              <div className="config-field" style={{ margin: 0 }}>
                <label>Perfil</label>
                <select
                  value={editingEntry?.role === "owner" ? "owner" : role}
                  onChange={(e) => setRole(e.target.value as AccessEntry["role"]) }
                  disabled={editingEntry?.role === "owner"}
                >
                  <option value="owner">Owner</option>
                  <option value="user">Usuário</option>
                  <option value="admin">Admin</option>
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
              <button type="button" className="btn btn-success" onClick={saveEntry}>
                {editingEmail ? "💾 Salvar alterações" : "＋ Adicionar e-mail"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={resetForm}>
                Limpar
              </button>
            </div>
          </div>
        </section>

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>E-mails autorizados</h3>
              <div style={{ marginTop: 4, fontSize: ".84rem", color: "var(--muted)" }}>
                {loading ? "Carregando lista..." : `${filteredEntries.length} registro(s)`}
              </div>
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar por e-mail ou nome"
              style={{ maxWidth: 280 }}
            />
          </div>

          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {loading ? (
              <div style={{ color: "var(--muted)", fontSize: ".9rem" }}>Atualizando acesso...</div>
            ) : filteredEntries.length ? (
              filteredEntries.map((entry) => (
                <div
                  key={entry.email}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{entry.email}</div>
                    <div style={{ marginTop: 4, fontSize: ".82rem", color: "var(--muted)" }}>
                      {entry.displayName || "Sem nome"} · {entry.role === "owner" ? "Owner" : entry.role === "admin" ? "Admin" : "Usuário"}
                      {entry.addedAt ? ` · ${new Date(entry.addedAt).toLocaleDateString("pt-BR")}` : ""}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-warning btn-xs" onClick={() => startEdit(entry)}>
                      ✏️ Editar
                    </button>
                    <button type="button" className="btn btn-danger btn-xs" onClick={() => deleteEntry(entry.email)} disabled={entry.role === "owner"}>
                      🗑 Remover
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: "var(--muted)", fontSize: ".9rem" }}>
                Nenhum e-mail encontrado.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
