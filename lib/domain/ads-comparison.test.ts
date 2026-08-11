import { describe, expect, it } from "vitest";
import {
  compararMetrica,
  derivarPeriodoAnterior,
  diasNoPeriodo,
  periodoAnteriorTemDadosSuficientes,
} from "./ads-comparison";

describe("diasNoPeriodo", () => {
  it("mesmo dia = 1 dia (inclusive)", () => {
    expect(diasNoPeriodo("2026-08-10", "2026-08-10")).toBe(1);
  });
  it("intervalo de uma semana = 7 dias", () => {
    expect(diasNoPeriodo("2026-08-01", "2026-08-07")).toBe(7);
  });
});

describe("derivarPeriodoAnterior", () => {
  it("mes corrente em andamento compara com os MESMOS N dias do mes anterior", () => {
    // hoje = 10 de agosto, from = 1 de agosto -> mes corrente em andamento
    const p = derivarPeriodoAnterior({ from: "2026-08-01", to: "2026-08-10" }, "2026-08-10");
    expect(p).toEqual({ from: "2026-07-01", to: "2026-07-10" });
  });

  it("mes corrente em andamento com dia que nao existe no mes anterior, usa o ultimo dia dele", () => {
    // 31 de agosto nao existe em fevereiro (28 dias em 2026, nao bissexto)
    const p = derivarPeriodoAnterior({ from: "2026-03-01", to: "2026-03-31" }, "2026-03-31");
    expect(p).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("mes fechado completo compara com o mes anterior completo", () => {
    // julho fechado (31 dias), hoje ja e agosto -> nao e "em andamento"
    const p = derivarPeriodoAnterior({ from: "2026-07-01", to: "2026-07-31" }, "2026-08-15");
    expect(p).toEqual({ from: "2026-06-01", to: "2026-06-30" });
  });

  it("intervalo customizado desloca pra tras o mesmo numero de dias, sem sobrepor", () => {
    // 10 dias (1 a 10 de agosto) -> anterior deve ser 10 dias terminando em 31/jul
    const p = derivarPeriodoAnterior({ from: "2026-08-01", to: "2026-08-10" }, "2026-09-01");
    expect(p).toEqual({ from: "2026-07-22", to: "2026-07-31" });
    expect(diasNoPeriodo(p.from, p.to)).toBe(10);
  });

  it("periodo customizado de 1 dia so desloca 1 dia pra tras", () => {
    const p = derivarPeriodoAnterior({ from: "2026-08-15", to: "2026-08-15" }, "2026-09-01");
    expect(p).toEqual({ from: "2026-08-14", to: "2026-08-14" });
  });
});

describe("compararMetrica", () => {
  it("sem periodo anterior disponivel, delta fica null (nao inventa 0%)", () => {
    const c = compararMetrica(100, null);
    expect(c.deltaAbsoluto).toBeNull();
    expect(c.deltaPercentual).toBeNull();
  });

  it("calcula delta absoluto e percentual corretamente", () => {
    const c = compararMetrica(150, 100);
    expect(c.deltaAbsoluto).toBe(50);
    expect(c.deltaPercentual).toBe(50);
  });

  it("anterior negativo/zero nao produz percentual (divisao por zero)", () => {
    const c = compararMetrica(100, 0);
    expect(c.deltaAbsoluto).toBe(100);
    expect(c.deltaPercentual).toBeNull();
  });

  it("queda registra delta negativo", () => {
    const c = compararMetrica(80, 100);
    expect(c.deltaAbsoluto).toBe(-20);
    expect(c.deltaPercentual).toBe(-20);
  });
});

describe("periodoAnteriorTemDadosSuficientes", () => {
  it("sem investimento e sem vendas no periodo anterior, dados insuficientes", () => {
    expect(periodoAnteriorTemDadosSuficientes(0, 0)).toBe(false);
  });
  it("com investimento OU vendas, ja considera suficiente", () => {
    expect(periodoAnteriorTemDadosSuficientes(10, 0)).toBe(true);
    expect(periodoAnteriorTemDadosSuficientes(0, 5)).toBe(true);
  });
});
