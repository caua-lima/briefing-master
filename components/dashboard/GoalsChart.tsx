"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  type ChartDataset,
  type TooltipItem,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { fmtBRL } from "@/lib/domain/calc";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

type Serie = { data: string; faturamento: number }[];

export default function GoalsChart({
  serieDiaria, mes, meta1, meta2, meta3, projecao,
}: {
  serieDiaria: Serie;
  mes: string;
  meta1: number;
  meta2: number | null;
  meta3: number | null;
  projecao: number;
}) {
  const [y, m] = mes.split("-").map(Number);
  const totalDias = new Date(y, m, 0).getDate();
  const hoje = new Date();
  const ehMesAtual = `${y}-${String(m).padStart(2, "0")}` === `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const diaAtual = ehMesAtual ? hoje.getDate() : totalDias;

  // faturamento por dia do mês
  const porDia = new Array(totalDias + 1).fill(0) as number[];
  for (const s of serieDiaria) {
    const d = Number(s.data.slice(8, 10));
    if (d >= 1 && d <= totalDias) porDia[d] += s.faturamento;
  }

  const labels = Array.from({ length: totalDias }, (_, i) => String(i + 1));
  const acumulado: (number | null)[] = [];
  let acc = 0;
  for (let d = 1; d <= totalDias; d++) {
    acc += porDia[d];
    acumulado.push(d <= diaAtual ? acc : null);
  }
  const totalAtual = acumulado[diaAtual - 1] ?? 0;

  // metas em cascata: só mostra a próxima depois de bater a anterior
  const metasToShow: { v: number; c: string; nome: string }[] = [{ v: meta1, c: "#4f8ef7", nome: "Meta 1" }];
  if (meta2 && totalAtual >= meta1) metasToShow.push({ v: meta2, c: "#f7c948", nome: "Meta 2" });
  if (meta3 && meta2 && totalAtual >= meta2) metasToShow.push({ v: meta3, c: "#a855f7", nome: "Meta 3" });
  const activeMeta = metasToShow.find((mm) => totalAtual < mm.v)?.v ?? metasToShow[metasToShow.length - 1].v;

  // ritmo ideal até a meta ativa
  const ritmo = labels.map((_, i) => (activeMeta / totalDias) * (i + 1));

  // projeção do dia atual até o fim do mês
  const projLine: (number | null)[] = new Array(totalDias).fill(null);
  if (ehMesAtual && diaAtual < totalDias) {
    for (let d = diaAtual; d <= totalDias; d++) {
      const t = (d - diaAtual) / (totalDias - diaAtual);
      projLine[d - 1] = totalAtual + (projecao - totalAtual) * t;
    }
  }

  const datasets: ChartDataset<"line", (number | null)[]>[] = [
    {
      label: "Faturamento acumulado",
      data: acumulado,
      borderColor: "#4f8ef7",
      backgroundColor: "rgba(79,142,247,.12)",
      fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2.5,
    },
    {
      label: "Ritmo ideal",
      data: ritmo,
      borderColor: "rgba(148,163,184,.35)",
      borderDash: [6, 4], fill: false, pointRadius: 0, borderWidth: 1.5,
    },
  ];
  if (ehMesAtual && diaAtual < totalDias) {
    datasets.push({
      label: "Projeção",
      data: projLine,
      borderColor: "#22c55e",
      borderDash: [4, 4], fill: false, pointRadius: 0, borderWidth: 2,
    });
  }
  for (const mm of metasToShow) {
    datasets.push({
      label: `${mm.nome} · ${fmtBRL(mm.v)}`,
      data: labels.map(() => mm.v),
      borderColor: mm.c,
      borderDash: [2, 3], fill: false, pointRadius: 0, borderWidth: 1.5,
    });
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: { position: "bottom" as const, labels: { color: "#94a3b8", font: { size: 10 }, boxWidth: 14, padding: 10 } },
      tooltip: {
        backgroundColor: "#1a1d27", borderColor: "#2e3350", borderWidth: 1,
        titleColor: "#e2e8f0", bodyColor: "#94a3b8",
        callbacks: {
          title: (items: TooltipItem<"line">[]) => `Dia ${items[0]?.label ?? ""}`,
          label: (ctx: TooltipItem<"line">) =>
            ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? fmtBRL(ctx.parsed.y as number) : "—"}`,
        },
      },
    },
    scales: {
      x: { grid: { color: "rgba(46,51,80,.4)" }, ticks: { color: "#64748b", maxTicksLimit: 16, font: { size: 10 } } },
      y: {
        grid: { color: "rgba(46,51,80,.4)" },
        ticks: { color: "#64748b", font: { size: 10 }, callback: (v: string | number) => `R$ ${Number(v).toLocaleString("pt-BR")}` },
      },
    },
  };

  return (
    <div style={{ height: 300 }}>
      <Line data={{ labels, datasets }} options={options} />
    </div>
  );
}
