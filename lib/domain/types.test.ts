import { describe, expect, it } from "vitest";
import { impostoNaData, isTaskAtrasada, roleLabel, type Task } from "./types";

describe("impostoNaData — imposto histórico (alíquota vale na data da VENDA, não a atual)", () => {
  it("sem faixas cadastradas, cai no campo antigo (compat com produto pré-faixas)", () => {
    expect(impostoNaData({ imposto: "8" }, "2026-01-01")).toBe(8);
  });

  it("sem faixas e sem campo antigo, é 0 — nunca inventa alíquota", () => {
    expect(impostoNaData({}, "2026-01-01")).toBe(0);
  });

  it("venda ANTES da primeira faixa paga 0 (ex.: virada de MEI isento pra ME)", () => {
    const prod = { impostoFaixas: [{ desde: "2026-03-01", pct: 6 }] };
    expect(impostoNaData(prod, "2026-01-15")).toBe(0);
  });

  it("venda depois da faixa entrar em vigor usa a alíquota dela", () => {
    const prod = { impostoFaixas: [{ desde: "2026-03-01", pct: 6 }] };
    expect(impostoNaData(prod, "2026-03-01")).toBe(6); // no dia exato já vale
    expect(impostoNaData(prod, "2026-06-01")).toBe(6);
  });

  it("com várias faixas, usa a MAIS RECENTE que já começou até a data da venda — histórico não muda quando uma faixa nova é cadastrada", () => {
    const prod = {
      impostoFaixas: [
        { desde: "2026-01-01", pct: 4 },
        { desde: "2026-06-01", pct: 8 },
        { desde: "2026-09-01", pct: 10 },
      ],
    };
    expect(impostoNaData(prod, "2026-03-01")).toBe(4); // só a 1ª faixa valia
    expect(impostoNaData(prod, "2026-07-01")).toBe(8); // 2ª faixa, não a mais nova
    expect(impostoNaData(prod, "2026-12-01")).toBe(10); // 3ª faixa
    // Regra crítica: uma venda de MARÇO nunca é recalculada com a alíquota de
    // SETEMBRO só porque a faixa nova foi cadastrada depois — o histórico é imutável.
    expect(impostoNaData(prod, "2026-03-01")).toBe(4);
  });

  it("faixas fora de ordem no array não importam — sempre pega a mais recente válida", () => {
    const prod = {
      impostoFaixas: [
        { desde: "2026-09-01", pct: 10 },
        { desde: "2026-01-01", pct: 4 },
        { desde: "2026-06-01", pct: 8 },
      ],
    };
    expect(impostoNaData(prod, "2026-07-01")).toBe(8);
  });

  it("faixa com pct inválido/ausente não quebra — vira 0, não NaN", () => {
    const prod = { impostoFaixas: [{ desde: "2026-01-01", pct: NaN }] };
    expect(impostoNaData(prod, "2026-02-01")).toBe(0);
  });
});

describe("roleLabel — normaliza papéis legados", () => {
  it("owner mostra Owner", () => {
    expect(roleLabel("owner")).toBe("Owner");
  });

  it("colaborador e papéis legados (admin/user) sempre viram Colaborador", () => {
    expect(roleLabel("colaborador")).toBe("Colaborador");
    expect(roleLabel("admin")).toBe("Colaborador");
    expect(roleLabel("user")).toBe("Colaborador");
  });
});

describe("isTaskAtrasada — tarefa vencida", () => {
  function task(over: Partial<Task> = {}): Task {
    return { id: "t1", title: "Teste", status: "todo", ...over };
  }

  it("sem prazo nunca está atrasada", () => {
    expect(isTaskAtrasada(task())).toBe(false);
  });

  it("prazo no passado e ainda não concluída está atrasada", () => {
    expect(isTaskAtrasada(task({ dueDate: "2000-01-01" }))).toBe(true);
  });

  it("prazo no passado mas já concluída NÃO está atrasada", () => {
    expect(isTaskAtrasada(task({ dueDate: "2000-01-01", status: "done" }))).toBe(false);
  });

  it("prazo no futuro distante não está atrasada", () => {
    expect(isTaskAtrasada(task({ dueDate: "2999-01-01" }))).toBe(false);
  });
});
