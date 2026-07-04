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
  const [syncLoading, setSyncLoading] = useState(false);
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

  async function sync() {
    setSyncLoading(true);
    setFeedback(null);
    try {
      const res = await authedFetch('/api/ml/sync-all', { method: 'POST' });
      if (res.ok) {
        setFeedback({ type: 'success', message: '✅ Sincronização concluída!' });
        setTimeout(() => setFeedback(null), 4000);
      } else {
        setFeedback({ type: 'error', message: '❌ Erro ao sincronizar' });
      }
    } catch {
      setFeedback({ type: 'error', message: '❌ Erro ao sincronizar' });
    } finally {
      setSyncLoading(false);
    }
  }

  async function swapAccount() {
    if (!confirm('Trocar conta do Mercado Livre?\n\nVocê será redirecionado para o login do ML.')) return;
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ textAlign: 'right', fontSize: '.8rem' }}>
        <div style={{ fontWeight: 700 }}>{data.user?.nickname || data.user_id}</div>
        <div style={{ color: 'var(--muted)', fontSize: '.72rem' }}>{data.user?.email || data.user?.site_id || ''}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={sync}
          disabled={syncLoading}
          className="btn btn-xs"
          style={{
            padding: '6px 10px', borderRadius: 8,
            background: syncLoading ? '#f5f5f5' : '#fff',
            border: '1px solid var(--border)',
            opacity: syncLoading ? 0.6 : 1,
            cursor: syncLoading ? 'not-allowed' : 'pointer'
          }}
        >
          {syncLoading ? '⏳ Sincronizando...' : '🔄 Sincronizar'}
        </button>
        <button
          onClick={swapAccount}
          disabled={swapLoading}
          className="btn btn-xs btn-primary"
          style={{
            padding: '6px 10px', borderRadius: 8,
            opacity: swapLoading ? 0.6 : 1,
            cursor: swapLoading ? 'not-allowed' : 'pointer'
          }}
        >
          {swapLoading ? '⏳ Trocando...' : '🔄 Trocar conta ML'}
        </button>
        {feedback && (
          <div style={{
            fontSize: '.75rem',
            color: feedback.type === 'success' ? '#22c55e' : '#ef4444',
            fontWeight: 600
          }}>
            {feedback.message}
          </div>
        )}
      </div>
    </div>
  );
}