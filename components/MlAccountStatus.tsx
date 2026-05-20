'use client'

import { useEffect, useState } from "react";
import { MLConnectButton } from "./MLConnectButton";

type Account = {
  connected: boolean;
  user_id?: string | null;
  user?: { id?: number; nickname?: string; site_id?: string; email?: string } | null;
};

export function MlAccountStatus() {
  const [data, setData] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncLoading, setSyncLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        // Verifica se o usuário desconectou intencionalmente
        const isDisconnected = localStorage.getItem('ml_disconnected');
        if (isDisconnected === 'true') {
          setData({ connected: false });
          setLoading(false);
          return;
        }

        const res = await fetch('/api/ml/account', { cache: 'no-store' });
        if (!res.ok) {
          setData({ connected: false });
          setLoading(false);
          return;
        }
        const json = await res.json();
        setData(json);
        // Limpa o flag de desconectado se conseguiu se conectar
        if (json.connected) {
          localStorage.removeItem('ml_disconnected');
        }
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
      const res = await fetch('/api/ml/sync-all', { method: 'POST' });
      if (res.ok) {
        setFeedback({ type: 'success', message: '✅ Sincronização iniciada!' });
        setTimeout(() => setFeedback(null), 3000);
      } else {
        setFeedback({ type: 'error', message: '❌ Erro ao sincronizar' });
      }
    } catch (error) {
      console.error('Erro ao sincronizar', error);
      setFeedback({ type: 'error', message: '❌ Erro ao sincronizar' });
    } finally {
      setSyncLoading(false);
    }
  }

  async function disconnect() {
    if (!confirm('Tem certeza que deseja desconectar sua conta Mercado Livre?')) return;
    setFeedback(null);
    try {
      const res = await fetch('/api/ml/disconnect', { method: 'POST' });
      if (res.ok) {
        localStorage.setItem('ml_disconnected', 'true');
        setFeedback({ type: 'success', message: '✅ Desconectado!' });
        setTimeout(() => setData({ connected: false }), 500);
      } else {
        setFeedback({ type: 'error', message: '❌ Erro ao desconectar' });
      }
    } catch (error) {
      console.error('Erro ao desconectar ML', error);
      setFeedback({ type: 'error', message: '❌ Erro ao desconectar' });
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
            padding: '6px 10px', 
            borderRadius: 8, 
            background: syncLoading ? '#f5f5f5' : '#fff', 
            border: '1px solid var(--border)',
            opacity: syncLoading ? 0.6 : 1,
            cursor: syncLoading ? 'not-allowed' : 'pointer'
          }}
        >
          {syncLoading ? '⏳ Sincronizando...' : '🔄 Sincronizar'}
        </button>
        <button
          onClick={disconnect}
          className="btn btn-xs btn-ghost"
          style={{ 
            padding: '6px 10px', 
            borderRadius: 8, 
            background: '#fff', 
            border: '1px solid var(--border)'
          }}
        >
          🚪 Desconectar
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
