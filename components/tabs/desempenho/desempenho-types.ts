import type { ResultadoCompradores } from "@/lib/domain/repurchase";
import type { ResultadoHeatmap } from "@/lib/domain/sales-heatmap";
import type { ResultadoEntregas } from "@/lib/domain/shipping-performance";
import type { SellerReputation } from "@/lib/domain/reputation";

export type DesempenhoResponse = {
  months: number;
  from: string;
  to: string;
  compradores: ResultadoCompradores;
  heatmap: ResultadoHeatmap;
  entregas: ResultadoEntregas;
  reputacao: SellerReputation | null;
  reputacaoIndisponivel: boolean;
  cached?: boolean;
};
