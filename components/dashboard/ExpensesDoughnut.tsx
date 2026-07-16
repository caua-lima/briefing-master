"use client";

import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type TooltipItem,
} from "chart.js";
import { Doughnut } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend);

type Props = {
  produto: number;
  envio?: number;
  taxasML: number;
  imposto?: number;
  ads: number;
  operacional: number;
};

export default function ExpensesDoughnut({ produto, envio = 0, taxasML, imposto = 0, ads, operacional }: Props) {
  const total = produto + envio + taxasML + imposto + ads + operacional;

  if (total === 0) {
    return (
      <div
        style={{
          height: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontSize: ".85rem",
        }}
      >
        Sem gastos registrados.
      </div>
    );
  }

  const data = {
    labels: ["Produto (CMV)", "Frete (envio)", "Taxas ML", "Imposto", "Ads", "Operacional"],
    datasets: [
      {
        data: [produto, envio, taxasML, imposto, ads, operacional],
        backgroundColor: [
          "rgba(99,102,241,.8)",
          "rgba(59,130,246,.8)",
          "rgba(245,158,11,.8)",
          "rgba(234,179,8,.8)",
          "rgba(239,68,68,.8)",
          "rgba(167,139,250,.8)",
        ],
        borderColor: "#1a1d27",
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "65%",
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: { color: "#64748b", font: { size: 10 }, padding: 10 },
      },
      tooltip: {
        backgroundColor: "#1a1d27",
        borderColor: "#2e3350",
        borderWidth: 1,
        titleColor: "#e2e8f0",
        bodyColor: "#64748b",
        callbacks: {
          label: (ctx: TooltipItem<"doughnut">) => {
            const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : "0";
            return ` ${ctx.label}: ${pct}%`;
          },
        },
      },
    },
  };

  return (
    <div style={{ height: 220, position: "relative" }}>
      <Doughnut data={data} options={options} />
    </div>
  );
}
