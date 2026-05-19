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

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ textAlign: 'right', fontSize: '.8rem' }}>
        <div style={{ fontWeight: 700 }}>{data.user?.nickname || data.user_id}</div>
        <div style={{ color: 'var(--muted)', fontSize: '.72rem' }}>{data.user?.email || data.user?.site_id || ''}</div>
      </div>
      <button
        onClick={async () => { await fetch('/api/ml/sync-all', { method: 'POST' }); }}
        className="btn btn-xs"
        style={{ padding: '6px 10px', borderRadius: 8, background: '#fff', border: '1px solid var(--border)' }}
      >
        Re-sincronizar
      </button>
    </div>
  );
}
