// Diagnóstico do Mercado Pago: qual conta o MP_ACCESS_TOKEN representa e se
// enxerga os pagamentos. Uso: node scripts/mp-diag.mjs
import fs from "node:fs";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      for (const line of fs.readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
      }
    } catch { /* arquivo não existe */ }
  }
}
loadEnv();

const token = process.env.MP_ACCESS_TOKEN;
const MP = "https://api.mercadopago.com";
const H = { Authorization: `Bearer ${token}`, Accept: "application/json" };

if (!token) {
  console.log("❌ MP_ACCESS_TOKEN não encontrado no .env / .env.local");
  console.log("   Adicione a linha:  MP_ACCESS_TOKEN=APP_USR-...   e rode de novo.");
  process.exit(0);
}
console.log("🔑 Token prefixo:", token.slice(0, 12) + "…  (tam " + token.length + ")");

// 1) Qual conta é esse token?
const me = await fetch(`${MP}/users/me`, { headers: H });
console.log("\n[users/me] HTTP", me.status);
if (me.ok) {
  const j = await me.json();
  console.log("  conta:", { id: j.id, nickname: j.nickname, site_id: j.site_id, email: j.email });
} else {
  console.log("  body:", (await me.text()).slice(0, 300));
}

// 2) Soma completa: A receber (release futuro) x Já liberado — igual ao endpoint.
const now = Date.now();
let aReceber = 0, liberado = 0, pend = 0, count = 0;
const porOp = {};
let offset = 0;
const limit = 100;
while (offset < 5000) {
  const url = `${MP}/v1/payments/search?sort=date_created&criteria=desc&limit=${limit}&offset=${offset}`;
  const s = await fetch(url, { headers: H });
  if (!s.ok) { console.log("\n[payments/search] HTTP", s.status, (await s.text()).slice(0, 300)); break; }
  const j = await s.json();
  const results = j.results ?? [];
  for (const p of results) {
    porOp[p.operation_type] = (porOp[p.operation_type] ?? 0) + 1;
    if (p.status !== "approved") continue;
    count++;
    const net = Number(p.transaction_details?.net_received_amount ?? p.transaction_amount ?? 0);
    const relMs = Date.parse(p.money_release_date ?? "");
    if (Number.isFinite(relMs) && relMs > now) { aReceber += net; pend++; }
    else liberado += net;
  }
  const total = j.paging?.total ?? 0;
  offset += results.length;
  if (results.length === 0 || offset >= total) break;
}
console.log("\n=== RESUMO (sem filtro) ===");
console.log("  aprovados:", count);
console.log("  A RECEBER (release futuro):", aReceber.toFixed(2), `(${pend} pagamentos)`);
console.log("  Ja liberado (historico):", liberado.toFixed(2));
console.log("  operation_type breakdown:", porOp);

// 3) Testa filtro de data relativo (NOW-90DAYS) pra acelerar e datar o "liberado"
for (const range of ["date_created", "money_release_date"]) {
  const u = `${MP}/v1/payments/search?range=${range}&begin_date=NOW-90DAYS&end_date=NOW-1MINUTES&sort=date_created&criteria=desc&limit=1`;
  const r = await fetch(u, { headers: H });
  console.log(`\n[filtro range=${range} NOW-90DAYS] HTTP ${r.status} · total:`, r.ok ? (await r.json()).paging?.total : (await r.text()).slice(0, 150));
}
// Futuro: para "a receber", filtra money_release_date >= agora
const uf = `${MP}/v1/payments/search?range=money_release_date&begin_date=NOW&end_date=NOW+90DAYS&status=approved&sort=date_created&criteria=desc&limit=1`;
const rf = await fetch(uf, { headers: H });
console.log(`[filtro money_release futuro] HTTP ${rf.status} · total:`, rf.ok ? (await rf.json()).paging?.total : (await rf.text()).slice(0, 150));
