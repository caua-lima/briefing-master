"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type TooltipItem,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { ArchivedDay } from "@/lib/domain/types";
import { formatDateBR } from "@/lib/domain/calc";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

type Props = {
  days: ArchivedDay[];
  windowDays: 7 | 15 | 30;
};

export default function RevenueLineChart({ days, windowDays }: Props) {
  const sorted = [...days]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-windowDays);

  const labels = sorted.map((d) => formatDateBR(d.date));
  const fatData = sorted.map((d) => d.totalFaturamento ?? 0);
  const liqData = sorted.map((d) => d.totalLiquido ?? 0);

  const data = {
    labels,
    datasets: [
      {
        label: "Faturamento",
        data: fatData,
        borderColor: "#7C3AED",
        backgroundColor: "rgba(124,58,237,.12)",
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointBackgroundColor: "#7C3AED",
      },
      {
        label: "Lucro Liquido",
        data: liqData,
        borderColor: "#34D399",
        backgroundColor: "rgba(52,211,153,.08)",
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointBackgroundColor: "#34D399",
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: {
        labels: { color: "#A9B4D0", font: { size: 11 } },
      },
      tooltip: {
        backgroundColor: "#171F3A",
        borderColor: "#2D3A61",
        borderWidth: 1,
        titleColor: "#F3F6FF",
        bodyColor: "#A9B4D0",
        callbacks: {
          label: (ctx: TooltipItem<"line">) => {
            const v = (ctx.parsed.y as number | null) ?? 0;
            return ` ${ctx.dataset.label}: R$ ${v.toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: "#A9B4D0", font: { size: 10 } },
        grid: { color: "#2D3A61" },
      },
      y: {
        ticks: {
          color: "#A9B4D0",
          font: { size: 10 },
          callback: (v: number | string) =>
            `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0 })}`,
        },
        grid: { color: "#2D3A61" },
      },
    },
  };

  if (sorted.length === 0) {
    return (
      <div
        style={{
          height: 260,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontSize: ".85rem",
        }}
      >
        Sem dados historicos para exibir.
      </div>
    );
  }

  return (
    <div style={{ height: 260, position: "relative" }}>
      <Line data={data} options={options} />
    </div>
  );
}
