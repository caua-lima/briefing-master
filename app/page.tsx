"use client";

import { useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { useUserData } from "@/components/useUserData";
import { AccessGuard, useAccess } from "@/components/tabs/AccessGuard";
import LoginCard from "@/components/LoginCard";
import MetasTab from "@/components/tabs/MetasTab";
import PedidosTab from "@/components/tabs/PedidosTab";
import AdsTab from "@/components/tabs/AdsTab";
import CustosTab from "@/components/tabs/CustosTab";
import EstoqueTab from "@/components/tabs/EstoqueTab";
import AccessControlTab from "@/components/tabs/AccessControlTab";
import Dashboard from "@/components/dashboard/Dashboard";
import { MlAccountStatus } from "@/components/MlAccountStatus";

type Tab = "dashboard" | "pedidos" | "ads" | "metas" | "custos" | "estoque" | "acesso";

// Todos veem tudo. Só o owner edita (as regras do Firestore garantem isso).
const NAV_ITEMS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "pedidos", label: "Pedidos" },
  { id: "ads", label: "Ads" },
  { id: "metas", label: "Metas" },
  { id: "custos", label: "Custos" },
  { id: "estoque", label: "Estoque" },
  { id: "acesso", label: "Acesso" },
];

// Ícones em linha (herdam a cor via currentColor) — visual limpo e profissional.
const ICON_PATHS: Record<Tab, React.ReactNode> = {
  dashboard: (<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  pedidos: (<><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></>),
  ads: (<><path d="M4 10v4a1 1 0 0 0 1 1h2l5 3.5V6.5L7 10H5a1 1 0 0 0-1 1z" /><path d="M16 9a4.5 4.5 0 0 1 0 6" /></>),
  metas: (<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>),
  custos: (<><path d="M6 3h12v18l-2-1.3L14 21l-2-1.3L10 21l-2-1.3L6 21z" /><path d="M9 8.5h6M9 12h6" /></>),
  estoque: (<><path d="M3 8l9-4 9 4-9 4-9-4z" /><path d="M3 8v8l9 4 9-4V8" /><path d="M12 12v8" /></>),
  acesso: (<><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>),
};

function NavIcon({ id }: { id: Tab }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
      {ICON_PATHS[id]}
    </svg>
  );
}

export default function Page() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          color: "var(--muted)",
          fontSize: ".9rem",
        }}
      >
        Carregando…
      </div>
    );
  }

  if (!user) return <LoginCard />;

  return (
    <AccessGuard>
      <AppShell />
    </AccessGuard>
  );
}

function AppShell() {
  const { user, signOut, signInWithAccountSelection } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [swappingAccount, setSwappingAccount] = useState(false);

  const data = useUserData(user?.uid);
  const { isOwner } = useAccess();
  const navItems = NAV_ITEMS;          // todos veem todas as abas
  const activeTab: Tab = tab;

  if (!user) return null;

  const dateLabel = new Date().toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  async function handleSwapAccount() {
    if (!confirm('Desconectar da conta Google atual e fazer login com outra?\n\nVocê poderá escolher qual conta Google usar.')) return;
    
    setSwappingAccount(true);
    try {
      // Primeiro faz logout da conta atual
      await signOut();
      
      // Depois redireciona para login com seleção de conta
      // Usa um pequeno delay para garantir que o logout foi processado
      setTimeout(async () => {
        try {
          await signInWithAccountSelection();
        } catch (err) {
          console.error('Erro ao fazer login com seleção de conta', err);
          setSwappingAccount(false);
        }
      }, 300);
    } catch (err) {
      console.error('Erro ao trocar conta', err);
      setSwappingAccount(false);
    }
  }

  return (
    <>
      {/* Sidebar overlay on mobile */}
      {sidebarOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.6)",
            zIndex: 40,
          }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          background: "var(--bg)",
        }}
      >
        {/* ── Sidebar ── */}
        <aside
          style={{
            width: 220,
            flexShrink: 0,
            background: "var(--surface)",
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            position: "fixed",
            top: 0,
            left: sidebarOpen ? 0 : -220,
            bottom: 0,
            zIndex: 50,
            transition: "left .22s ease",
          }}
          className="app-sidebar"
        >
          {/* Logo */}
          <div
            style={{
              padding: "20px 20px 16px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span
                style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "linear-gradient(135deg,#4f8ef7,#a78bfa)",
                  color: "#fff", fontWeight: 800, fontSize: ".9rem", letterSpacing: "-.02em",
                }}
              >
                ML
              </span>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: ".98rem",
                  lineHeight: 1.15,
                  background: "linear-gradient(135deg,#4f8ef7,#a78bfa)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Dashboard<br />Mercado Livre
              </div>
            </div>
            <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: 8, textTransform: "capitalize" }}>
              {dateLabel}
            </div>
          </div>

          {/* Nav items */}
          <nav style={{ flex: 1, padding: "10px 10px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setTab(item.id);
                    setSidebarOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 9,
                    border: "none",
                    background: active ? "rgba(79,142,247,.13)" : "transparent",
                    color: active ? "var(--accent)" : "var(--muted)",
                    boxShadow: active ? "inset 3px 0 0 var(--accent)" : "none",
                    fontSize: ".9rem",
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                    transition: "background .15s, color .15s",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLButtonElement).style.background = "var(--surface2)";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--muted)";
                    }
                  }}
                >
                  <NavIcon id={item.id} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* User / signout */}
          <div
            style={{
              padding: "14px 16px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
              }}
            >
              {user.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.photoURL}
                  alt=""
                  style={{ width: 28, height: 28, borderRadius: "50%" }}
                />
              ) : null}
              <span
                style={{
                  fontSize: ".75rem",
                  color: "var(--muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
              >
                {user.displayName || user.email}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={handleSwapAccount}
              disabled={swappingAccount}
              style={{ width: "100%", justifyContent: "center", marginBottom: 6, opacity: swappingAccount ? 0.6 : 1, cursor: swappingAccount ? 'not-allowed' : 'pointer' }}
            >
              {swappingAccount ? 'Trocando...' : 'Trocar conta'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={signOut}
              disabled={swappingAccount}
              style={{ width: "100%", justifyContent: "center", opacity: swappingAccount ? 0.6 : 1, cursor: swappingAccount ? 'not-allowed' : 'pointer' }}
            >
              Sair
            </button>
          </div>
        </aside>

        {/* ── Main content ── */}
        <div
          style={{
            flex: 1,
            marginLeft: 220,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
          className="app-main"
        >
          {/* Topbar */}
          <header
            style={{
              background: "var(--surface)",
              borderBottom: "1px solid var(--border)",
              padding: "12px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              position: "sticky",
              top: 0,
              zIndex: 30,
            }}
          >
            {/* Hamburger for mobile */}
            <button
              type="button"
              className="btn btn-ghost btn-xs sidebar-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: ".95rem" }}>
              <span style={{ color: "var(--accent)", display: "inline-flex" }}><NavIcon id={activeTab} /></span>
              {NAV_ITEMS.find((n) => n.id === activeTab)?.label}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <MlAccountStatus />
        </div>
          </header>

          {/* Tab content */}
          <main className="app-content" style={{ flex: 1, minWidth: 0 }}>
            {!data.ready ? (
              <div
                style={{
                  textAlign: "center",
                  padding: 48,
                  color: "var(--muted)",
                  fontSize: ".9rem",
                }}
              >
                Carregando dados…
              </div>
            ) : (
              <>
                {!isOwner && (
                  <div style={{ marginBottom: 14, padding: "8px 14px", background: "rgba(100,116,139,.12)", border: "1px solid var(--border)", borderRadius: 8, fontSize: ".8rem", color: "var(--muted)" }}>
                    Modo <b>somente leitura</b> — você pode ver tudo, mas alterações são permitidas apenas ao owner.
                  </div>
                )}
                {activeTab === "dashboard" && <Dashboard data={data} onVerEstoque={() => setTab("estoque")} />}
                {activeTab === "pedidos" && <PedidosTab />}
                {activeTab === "ads" && <AdsTab />}
                {activeTab === "metas" && <MetasTab uid={user.uid} data={data} />}
                {activeTab === "custos" && <CustosTab uid={user.uid} data={data} />}
                {activeTab === "estoque" && <EstoqueTab uid={user.uid} data={data} />}
                {activeTab === "acesso" && <AccessControlTab uid={user.uid} data={data} />}
              </>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
