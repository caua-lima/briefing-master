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

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/ml/account', { cache: 'no-store' });
        if (!res.ok) return setData({ connected: false });
        const json = await res.json();
        setData(json);
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

  async function disconnect() {
    try {
      const res = await fetch('/api/ml/disconnect', { method: 'POST' });
      if (res.ok) {
        setData({ connected: false });
      }
    } catch (error) {
      console.error('Erro ao desconectar ML', error);
    }
  }

  async function swapAccount() {
    try {
      const res = await fetch('/api/ml/disconnect', { method: 'POST' });
      if (res.ok) {
        window.location.href = '/api/ml/auth';
      }
    } catch (error) {
      console.error('Erro ao trocar conta ML', error);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ textAlign: 'right', fontSize: '.8rem' }}>
        <div style={{ fontWeight: 700 }}>{data.user?.nickname || data.user_id}</div>
        <div style={{ color: 'var(--muted)', fontSize: '.72rem' }}>{data.user?.email || data.user?.site_id || ''}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={async () => { await fetch('/api/ml/sync-all', { method: 'POST' }); }}
          className="btn btn-xs"
          style={{ padding: '6px 10px', borderRadius: 8, background: '#fff', border: '1px solid var(--border)' }}
        >
          Re-sincronizar
        </button>
        <button
          onClick={disconnect}
          className="btn btn-xs btn-ghost"
          style={{ padding: '6px 10px', borderRadius: 8, background: '#fff', border: '1px solid var(--border)' }}
        >
          Desconectar
        </button>
        <button
          onClick={swapAccount}
          className="btn btn-xs btn-primary"
          style={{ padding: '6px 10px', borderRadius: 8 }}
        >
          Trocar conta
        </button>
      </div>
    </div>
  );
}
