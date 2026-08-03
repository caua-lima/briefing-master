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
        // MESMA ordem e MESMAS cores de COST_COLORS em Dashboard.tsx — a
        // barra de composição de custos e este gráfico mostram os mesmos
        // valores, então a cor de cada custo tem que bater nos dois.
        backgroundColor: [
          "#8B5CF6", // Produto (CMV)
          "#22D3EE", // Frete (envio)
          "#38BDF8", // Taxas ML
          "#FBBF24", // Imposto
          "#F472B6", // Ads
          "#FB7185", // Operacional
        ],
        borderColor: "#171F3A",
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
        labels: { color: "#A9B4D0", font: { size: 10 }, padding: 10 },
      },
      tooltip: {
        backgroundColor: "#171F3A",
        borderColor: "#2D3A61",
        borderWidth: 1,
        titleColor: "#F3F6FF",
        bodyColor: "#A9B4D0",
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
