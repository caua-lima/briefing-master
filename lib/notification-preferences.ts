import "server-only";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from "@/lib/domain/notification-preferences";

/**
 * Preferências de UM destinatário, por e-mail (é assim que pushTokens
 * identifica quem recebe). O documento fica em usuarios/{uid}/preferences/
 * notifications — resolve o uid via Admin Auth (getUserByEmail), sem
 * precisar manter um mapa email→uid próprio.
 *
 * Falha (usuário sem preferências salvas ainda, ou erro de rede) sempre cai
 * pro DEFAULT — aditivo, igual ao resto do app: quem nunca configurou nada
 * continua recebendo exatamente como recebia antes desta feature existir.
 */
export async function getNotificationPreferencesByEmail(email: string): Promise<NotificationPreferences> {
  try {
    const user = await getAdminAuth().getUserByEmail(email);
    const snap = await getAdminDb().doc(`usuarios/${user.uid}/preferences/notifications`).get();
    if (!snap.exists) return DEFAULT_NOTIFICATION_PREFERENCES;
    const data = snap.data() ?? {};
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...data,
      toggles: { ...DEFAULT_NOTIFICATION_PREFERENCES.toggles, ...(data.toggles ?? {}) },
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

/** Minutos desde 00:00 e dia da semana (0=domingo) no fuso BR (-03:00), sem depender de Intl/timezone do servidor. */
export function agoraBR(): { minutosDoDia: number; diaSemana: number } {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return { minutosDoDia: d.getUTCHours() * 60 + d.getUTCMinutes(), diaSemana: d.getUTCDay() };
}
