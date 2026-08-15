import { describe, expect, it } from "vitest";
import { agruparLembretes, diasAtraso, textoLembrete, type TarefaPrazo } from "./task-reminders";

const HOJE = "2026-08-15";

function t(over: Partial<TarefaPrazo> = {}): TarefaPrazo {
  return { id: "t1", title: "Responder cliente", status: "todo", priority: "media", dueDate: HOJE, assignedTo: "eu@x.com", ...over };
}

describe("diasAtraso", () => {
  it("mesmo dia = 0, futuro = negativo, passado = positivo", () => {
    expect(diasAtraso(HOJE, HOJE)).toBe(0);
    expect(diasAtraso("2026-08-20", HOJE)).toBe(-5);
    expect(diasAtraso("2026-08-10", HOJE)).toBe(5);
  });

  it("atravessa virada de mes e de ano sem errar o dia", () => {
    expect(diasAtraso("2026-07-31", "2026-08-01")).toBe(1);
    expect(diasAtraso("2025-12-31", "2026-01-01")).toBe(1);
  });

  it("data invalida nao explode nem inventa atraso", () => {
    expect(diasAtraso("", HOJE)).toBe(0);
    expect(diasAtraso("15/08/2026", HOJE)).toBe(0);
  });
});

describe("agruparLembretes", () => {
  it("separa o que vence hoje do que ja passou", () => {
    const r = agruparLembretes([t({ id: "a" }), t({ id: "b", dueDate: "2026-08-10" })], HOJE);
    expect(r).toHaveLength(1);
    expect(r[0].venceHoje.map((x) => x.id)).toEqual(["a"]);
    expect(r[0].atrasadas.map((x) => x.id)).toEqual(["b"]);
  });

  it("prazo no futuro nao vira lembrete — ainda da tempo", () => {
    expect(agruparLembretes([t({ dueDate: "2026-08-20" })], HOJE)).toEqual([]);
  });

  it("concluida nunca lembra, mesmo atrasada", () => {
    expect(agruparLembretes([t({ status: "done", dueDate: "2026-01-01" })], HOJE)).toEqual([]);
  });

  it("sem prazo ou sem responsavel nao gera aviso", () => {
    expect(agruparLembretes([t({ dueDate: undefined })], HOJE)).toEqual([]);
    expect(agruparLembretes([t({ assignedTo: "" })], HOJE)).toEqual([]);
  });

  it("agrupa por pessoa, e o e-mail e normalizado", () => {
    const r = agruparLembretes([t({ assignedTo: "EU@x.com" }), t({ id: "b", assignedTo: " eu@X.com " })], HOJE);
    expect(r).toHaveLength(1);
    expect(r[0].email).toBe("eu@x.com");
    expect(r[0].venceHoje).toHaveLength(2);
  });

  it("dentro do grupo, prioridade manda; empate cai no prazo mais antigo", () => {
    const r = agruparLembretes([
      t({ id: "baixa", priority: "baixa", dueDate: "2026-08-01" }),
      t({ id: "critica", priority: "critica", dueDate: "2026-08-14" }),
      t({ id: "alta", priority: "alta", dueDate: "2026-08-13" }),
    ], HOJE);
    expect(r[0].atrasadas.map((x) => x.id)).toEqual(["critica", "alta", "baixa"]);
  });
});

describe("textoLembrete", () => {
  it("nada pendente nao vira notificacao", () => {
    expect(textoLembrete({ email: "e", venceHoje: [], atrasadas: [] }, HOJE)).toBeNull();
  });

  it("atraso manda no titulo mesmo tendo coisa vencendo hoje", () => {
    const [l] = agruparLembretes([t({ id: "a" }), t({ id: "b", dueDate: "2026-08-10" })], HOJE);
    const r = textoLembrete(l, HOJE)!;
    expect(r.title).toBe("1 tarefa atrasada");
    expect(r.body).toContain("5 dias");
    expect(r.body).toContain("1 vence hoje");
  });

  it("so vencendo hoje usa o titulo de hoje", () => {
    const [l] = agruparLembretes([t()], HOJE);
    expect(textoLembrete(l, HOJE)!.title).toBe("1 tarefa vence hoje");
  });

  it("plural correto em portugues", () => {
    const [l] = agruparLembretes([t({ id: "a" }), t({ id: "b" })], HOJE);
    expect(textoLembrete(l, HOJE)!.title).toBe("2 tarefas vencem hoje");
  });

  it("nomeia a mais urgente e conta o resto — nunca um numero solto", () => {
    const [l] = agruparLembretes([
      t({ id: "a", title: "Pagar fornecedor", priority: "critica", dueDate: "2026-08-12" }),
      t({ id: "b", title: "Outra", dueDate: "2026-08-13" }),
      t({ id: "c", title: "Mais uma", dueDate: "2026-08-14" }),
    ], HOJE);
    const r = textoLembrete(l, HOJE)!;
    expect(r.body).toContain("Pagar fornecedor");
    expect(r.body).toContain("+2 outras");
  });
});
