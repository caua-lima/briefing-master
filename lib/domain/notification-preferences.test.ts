import { describe, expect, it } from "vitest";
import {
  CRITICAL_NOTIFICATION_TYPES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  isPushAllowedForRecipient,
  type NotificationPreferences,
} from "./notification-preferences";

function prefs(over: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, toggles: { ...DEFAULT_NOTIFICATION_PREFERENCES.toggles }, ...over };
}

const MEIO_DIA_QUARTA = { minutosDoDia: 12 * 60, diaSemana: 3 };

describe("isPushAllowedForRecipient — permissão de entrega de push por destinatário", () => {
  it("preferências padrão (nunca configuradas) permitem tudo — aditivo, não quebra quem nunca mexeu", () => {
    expect(isPushAllowedForRecipient("sale_paid", DEFAULT_NOTIFICATION_PREFERENCES, MEIO_DIA_QUARTA)).toBe(true);
  });

  it("toggle desligado bloqueia só aquele tipo", () => {
    const p = prefs({ toggles: { ...DEFAULT_NOTIFICATION_PREFERENCES.toggles, sale_paid: false } });
    expect(isPushAllowedForRecipient("sale_paid", p, MEIO_DIA_QUARTA)).toBe(false);
    expect(isPushAllowedForRecipient("sale_high_value", p, MEIO_DIA_QUARTA)).toBe(true);
  });

  it("'somente críticas' bloqueia tipo não-crítico mesmo com toggle ligado", () => {
    const p = prefs({ onlyCritical: true });
    expect(isPushAllowedForRecipient("sale_high_value", p, MEIO_DIA_QUARTA)).toBe(false);
  });

  it("'somente críticas' NUNCA bloqueia um tipo crítico (prejuízo/cancelamento/devolução)", () => {
    const p = prefs({ onlyCritical: true });
    for (const tipo of CRITICAL_NOTIFICATION_TYPES) {
      expect(isPushAllowedForRecipient(tipo, p, MEIO_DIA_QUARTA)).toBe(true);
    }
  });

  it("horário silencioso desabilitado (padrão) nunca bloqueia, mesmo de madrugada", () => {
    const p = prefs({ quietHoursEnabled: false });
    expect(isPushAllowedForRecipient("sale_paid", p, { minutosDoDia: 3 * 60, diaSemana: 3 })).toBe(true);
  });

  it("dentro do horário silencioso bloqueia tipo comum", () => {
    const p = prefs({ quietHoursEnabled: true, quietHoursStart: "22:30", quietHoursEnd: "07:30" });
    // 23:00 — dentro da janela que cruza a meia-noite
    expect(isPushAllowedForRecipient("sale_paid", p, { minutosDoDia: 23 * 60, diaSemana: 3 })).toBe(false);
    // 03:00 — também dentro (do outro lado da meia-noite)
    expect(isPushAllowedForRecipient("sale_paid", p, { minutosDoDia: 3 * 60, diaSemana: 3 })).toBe(false);
    // meio-dia — fora da janela
    expect(isPushAllowedForRecipient("sale_paid", p, MEIO_DIA_QUARTA)).toBe(true);
  });

  it("horário silencioso NUNCA bloqueia tipo crítico — prejuízo acorda alguém de propósito", () => {
    const p = prefs({ quietHoursEnabled: true, quietHoursStart: "22:30", quietHoursEnd: "07:30" });
    expect(isPushAllowedForRecipient("sale_negative_margin", p, { minutosDoDia: 3 * 60, diaSemana: 3 })).toBe(true);
    expect(isPushAllowedForRecipient("sale_cancelled", p, { minutosDoDia: 23 * 60, diaSemana: 3 })).toBe(true);
  });

  it("horário silencioso só vale nos dias marcados em quietHoursDays", () => {
    const p = prefs({ quietHoursEnabled: true, quietHoursStart: "22:30", quietHoursEnd: "07:30", quietHoursDays: [0, 6] }); // só fim de semana
    // quarta-feira (diaSemana 3) não está na lista — silencioso não se aplica mesmo de madrugada
    expect(isPushAllowedForRecipient("sale_paid", p, { minutosDoDia: 3 * 60, diaSemana: 3 })).toBe(true);
    // domingo (0) de madrugada — está na lista, bloqueia
    expect(isPushAllowedForRecipient("sale_paid", p, { minutosDoDia: 3 * 60, diaSemana: 0 })).toBe(false);
  });

  it("resumo agrupado (isSummary) checa o toggle sales_summary, não o toggle do tipo individual", () => {
    const p = prefs({ toggles: { ...DEFAULT_NOTIFICATION_PREFERENCES.toggles, sale_paid: false, sales_summary: true } });
    // sale_paid está desligado, mas isSummary=true olha sales_summary (ligado)
    expect(isPushAllowedForRecipient("sale_paid", p, MEIO_DIA_QUARTA, true)).toBe(true);
  });

  it("resumo agrupado desligado bloqueia mesmo se o tipo individual estivesse ligado", () => {
    const p = prefs({ toggles: { ...DEFAULT_NOTIFICATION_PREFERENCES.toggles, sales_summary: false } });
    expect(isPushAllowedForRecipient("sale_paid", p, MEIO_DIA_QUARTA, true)).toBe(false);
  });

  it("tipo 'system' não tem toggle (TYPE_TO_TOGGLE é null) — nunca bloqueado por preferência de tipo", () => {
    const p = prefs();
    expect(isPushAllowedForRecipient("system", p, MEIO_DIA_QUARTA)).toBe(true);
  });
});
