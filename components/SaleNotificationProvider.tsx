"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onForegroundPush, type ForegroundPushEvent } from "@/lib/firebase/push";
import { SaleNotificationToast } from "./SaleNotificationToast";

const MAX_VISIVEIS = 3;

/**
 * Duração antes do fechamento automático, por tipo — margem negativa fica
 * até fechar manualmente (ou 15s, o que vier primeiro: ainda fecha sozinho
 * pra não empilhar toast esquecido na tela, só demora mais por ser o aviso
 * mais importante). Tipo sem entrada aqui (ex.: sync_warning/system) cai no
 * padrão de venda normal.
 */
const DURACAO_MS: Partial<Record<string, number>> = {
  sale_paid: 8000,
  sale_high_value: 12000,
  sale_low_margin: 10000,
  sale_negative_margin: 15000,
  sale_cancelled: 12000,
  return_completed: 12000,
  return_opened: 12000,
};
const DURACAO_PADRAO = 8000;

type ToastItem = ForegroundPushEvent & { _key: string };

export function SaleNotificationProvider({ onNavigate }: { onNavigate: (deepLink: string) => void }) {
  const [visiveis, setVisiveis] = useState<ToastItem[]>([]);
  const filaRef = useRef<ToastItem[]>([]);
  const vistosRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return onForegroundPush((evt) => {
      // Nunca dois toasts pro mesmo eventId — mesmo se o SDK entregar a
      // mesma mensagem duas vezes (reconexão do onMessage, etc.), só o
      // primeiro vira toast.
      const chave = evt.eventId || `${evt.tag}-${evt.timestamp}`;
      if (vistosRef.current.has(chave)) return;
      vistosRef.current.add(chave);

      const item: ToastItem = { ...evt, _key: chave };
      setVisiveis((atual) => {
        if (atual.length < MAX_VISIVEIS) return [...atual, item];
        filaRef.current.push(item);
        return atual;
      });
    });
  }, []);

  const fechar = useCallback((chave: string) => {
    setVisiveis((atual) => {
      const resto = atual.filter((t) => t._key !== chave);
      const proximo = filaRef.current.shift();
      return proximo ? [...resto, proximo] : resto;
    });
  }, []);

  useEffect(() => {
    const timers = visiveis.map((t) =>
      setTimeout(() => fechar(t._key), DURACAO_MS[t.type] ?? DURACAO_PADRAO),
    );
    return () => timers.forEach(clearTimeout);
  }, [visiveis, fechar]);

  if (visiveis.length === 0) return null;

  return (
    <div className="sale-toast-region" aria-label="Notificações de venda">
      {visiveis.map((t) => (
        <SaleNotificationToast
          key={t._key}
          event={t}
          onClose={() => fechar(t._key)}
          onNavigate={(link) => { onNavigate(link); fechar(t._key); }}
        />
      ))}
    </div>
  );
}
