'use client'

import { useEffect, useState } from "react";
import { MLConnectButton } from "./MLConnectButton";
import { authedFetch } from "@/lib/api/authed-fetch";

type Account = {
  connected: boolean;
  user_id?: string | null;
  user?: { id?: number; nickname?: string; site_id?: string; email?: string } | null;
};

export function MlAccountStatus() {
  const [data, setData] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [swapLoading, setSwapLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await authedFetch('/api/ml/account', { cache: 'no-store' });
        if (!res.ok) { setData({ connected: false }); setLoading(false); return; }
        const json = await res.json();
        setData(json);
        if (json.connected) localStorage.removeItem('ml_disconnected');
      } catch (e) {
        setData({ connected: false });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <MLConnectButton />;
  if (!data || !data.connected) return <MLConnectButton />;

  async function swapAccount() {
    if (!confirm('Reconectar o Mercado Livre?\n\nVocê será redirecionado para o login do ML e deve autorizar todas as permissões (inclusive Publicidade).')) return;
    setSwapLoading(true);
    setFeedback(null);
    try {
      const res = await authedFetch('/api/ml/disconnect', { method: 'POST' });
      if (res.ok) {
        localStorage.setItem('ml_disconnected', 'true');
        window.location.href = '/api/ml/auth?login=true';
      } else {
        setFeedback({ type: 'error', message: '❌ Erro ao trocar conta' });
        setSwapLoading(false);
      }
    } catch {
      setFeedback({ type: 'error', message: '❌ Erro ao trocar conta' });
      setSwapLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      {/* No celular some (.acct-text): o nickname e o e-mail já aparecem no
          rodapé da sidebar, e aqui só empurravam o botão pra fora da tela. */}
      <div className="acct-text" style={{ textAlign: 'right', fontSize: '.8rem', minWidth: 0 }}>
        <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.user?.nickname || data.user_id}</div>
        <div style={{ color: 'var(--muted)', fontSize: '.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.user?.email || data.user?.site_id || ''}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
        <button
          onClick={swapAccount}
          disabled={swapLoading}
          className="btn btn-xs btn-primary"
          title="Reconectar o Mercado Livre (renova permissões, inclusive Publicidade)"
          aria-label="Reconectar Mercado Livre"
          style={{
            padding: '6px 10px', borderRadius: 8, flexShrink: 0,
            opacity: swapLoading ? 0.6 : 1,
            cursor: swapLoading ? 'not-allowed' : 'pointer'
          }}
        >
          {swapLoading
            ? <><span aria-hidden>⏳</span><span className="acct-btn-label">Reconectando...</span></>
            : <><span aria-hidden>🔌</span><span className="acct-btn-label">Reconectar ML</span></>}
        </button>
        {feedback && (
          <div style={{
            fontSize: '.75rem',
            color: feedback.type === 'success' ? '#36B37E' : '#D65A4A',
            fontWeight: 600
          }}>
            {feedback.message}
          </div>
        )}
      </div>
    </div>
  );
}