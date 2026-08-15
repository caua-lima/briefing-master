import type { ResultadoCompradores } from "@/lib/domain/repurchase";
import type { ResultadoHeatmap } from "@/lib/domain/sales-heatmap";
import type { ResultadoEntregas } from "@/lib/domain/shipping-performance";
import type { SellerReputation } from "@/lib/domain/reputation";
import type { RequisitoMercadoLider } from "@/lib/domain/mercadolider-requisitos";

export type DesempenhoResponse = {
  months: number;
  /** Quando setado, o periodo foi medido em dias (pra bater com o painel do ML). */
  dias: number | null;
  /** Pedidos validos do periodo sem buyer_id — ficam fora da conta de compradores. */
  semComprador: number;
  from: string;
  to: string;
  compradores: ResultadoCompradores;
  /** Data mais antiga entre os pedidos sincronizados (YYYY-MM-DD), ou null se não há nenhum. */
  historicoDesde: string | null;
  heatmap: ResultadoHeatmap;
  entregas: ResultadoEntregas;
  reputacao: SellerReputation | null;
  reputacaoIndisponivel: boolean;
  registrationDate: string | null;
  requisitosMercadoLider: RequisitoMercadoLider[];
  cached?: boolean;
};
