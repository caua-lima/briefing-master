# Controle ML → SaaS — Arquitetura & Roadmap

> Documento vivo. Vive **só no branch `saas`**. A `main` (dashboard pessoal do
> dono) não conhece nada disso e continua rodando intacta.

## 1. Objetivo e modelo de negócio

Transformar o dashboard single-tenant num SaaS vendido a vendedores do Mercado
Livre que querem controle de faturamento, lucro, estoque e fluxo de caixa.

- **Venda:** por call (1:1). Sem checkout automático.
- **Pagamento:** direto pro dono, **fora do sistema**. Não há gateway.
- **Liberação de acesso:** manual, pelo **admin master** (o dono), por e-mail e
  com **prazo de validade** (X tempo). Ex.: libera `caua@gmail.com` por 12 meses.
- **Preço-alvo:** R$ 30–45/mês (assinatura anual). Definido fora do código.

## 2. Isolamento — como o SaaS não quebra o dashboard pessoal

Três camadas 100% separadas. O SaaS pode pegar fogo que a `main` nem percebe.

| Camada   | Dashboard pessoal (hoje)        | SaaS (novo)                          |
|----------|----------------------------------|--------------------------------------|
| Branch   | `main`                           | `saas`                               |
| Deploy   | Vercel atual → domínio atual     | **Vercel novo** → domínio novo       |
| Banco    | Firebase `vazxpress-a2350`       | **Firebase novo** (multi-tenant)     |
| ML/MP    | Tokens do dono (env vars)        | OAuth por cliente                    |

**Regra de ouro:** correções fluem `main` → `saas` (a gente traz com merge/
cherry-pick). Nunca `saas` → `main` até o SaaS estar maduro e ser decisão
explícita.

### Status do isolamento
- [x] Branch `saas` criado a partir da `main`.
- [ ] Firebase novo criado (o dono cria — ver §6).
- [ ] Projeto Vercel novo apontando pro branch `saas` (o dono cria — ver §6).
- [ ] App do Mercado Livre com OAuth multiusuário e redirect do domínio novo.

## 3. Modelo de acesso (liberação manual pelo admin master)

Dois portões independentes:

1. **Portão de licença** — "essa pessoa fechou comigo e está no prazo?"
   - Coleção `access_grants/{emailNormalizado}`:
     ```
     { email, expiresAt (timestamp), status: "ativo"|"suspenso",
       nota, criadoEm, criadoPor, plano? }
     ```
   - No login (Google), checa o grant do e-mail do usuário:
     - existe + `status ativo` + `expiresAt > agora` → segue pro portão 2.
     - senão → tela **"Acesso não liberado / expirado — fale com o vendedor"**.
   - **Admin master** (e-mail do dono, via env `MASTER_EMAILS`): painel pra
     criar/renovar/suspender grants e ver quem vence quando.
   - Já existe base pra isso: `components/tabs/AccessControlTab.tsx` e
     `AccessGuard.tsx` (roles owner/user). O grant com validade é a evolução.

2. **Portão de identidade** — "de quem são os dados?" (ver §4). Ter licença não
   basta: cada cliente conecta a PRÓPRIA conta ML/MP e vê só o dado dele.

## 4. Multi-tenancy (a parte pesada do refactor)

Hoje o app é single-tenant. Tudo que precisa deixar de ser global:

### 4.1 Identidade ML/MP — de env var para "por usuário"
Hoje (global) → SaaS (por tenant):
- `ML_SELLER_ID` (env) → `seller_id` derivado do token do cliente via
  `/users/me`. **Aparece em:** `lib/ml/orders.ts`, `lib/ml/sync.ts`,
  `app/api/ml/{today,returns,estoque-forecast,mp-saldo,debug-*}/route.ts`.
- `ml_tokens/main` (token único) → `users/{uid}/ml_token`. **Aparece em:**
  `app/api/ml/{token,account,callback,disconnect,force-logout,returns}`.
- `MP_ACCESS_TOKEN` (env) → `users/{uid}/mp_token` via OAuth do Mercado Pago.
  **Aparece em:** `app/api/ml/{mp-fluxo,mp-saldo}/route.ts`.

> Este é o item de maior esforço: quase toda rota de API assume o token/seller
> globais. O caminho seguro é criar um `getTenant(req)` que resolve
> `{ uid, mlToken, sellerId, mpToken }` do usuário logado e passar isso pra
> baixo, em vez de ler env var / `ml_tokens/main`.

### 4.2 Dados por usuário
Coleções globais hoje → subcoleção por usuário:
- `ml_orders`, `ml_returns`, `estoque`, `custos`, e os docs de
  financeiro/metas/goals (em `lib/firebase/data.ts`) → `users/{uid}/<coleção>`.
- **Regras do Firestore:** cada usuário só lê/escreve `users/{uid}/**`; admin
  master lê `access_grants`. Sem isso, vaza dado de um cliente pro outro — é o
  risco nº 1 de um SaaS financeiro.

### 4.3 Sincronização por tenant
O `sync-all` hoje sincroniza a conta do dono. No SaaS, roda por usuário (sob
demanda ao abrir + cron por tenant ativo). Cuidar de rate limit do ML por conta.

## 5. Roadmap (cada fase entrega algo testável)

1. **Isolamento** — branch/Vercel/Firebase novos. (em andamento)
2. **Multi-tenancy dos dados** — escopo `users/{uid}/…` + regras Firestore.
3. **ML OAuth por usuário** — `getTenant`, de-globalizar seller_id/token.
4. **MP OAuth por usuário** — conectar Mercado Pago de terceiros.
5. **Licença + admin master** — `access_grants`, tela bloqueada, painel do dono.
6. **Onboarding** — cadastro → conecta ML → conecta MP → (dono libera) → usa.
7. **Landing + tráfego** — página de venda, provas, agendamento de call.

Versão vendável já no passo 5–6.

## 6. O que o DONO precisa fazer fora do código

- Criar o **Firebase novo** (Auth Google + Firestore) e me passar as chaves
  (vão em env do Vercel novo, nunca no código).
- Criar o **projeto Vercel novo** ligado a este repo, **fixado no branch `saas`**,
  com domínio próprio.
- No **app do Mercado Livre**: habilitar OAuth multiusuário e adicionar o
  redirect URI do domínio novo (o app atual é o do uso pessoal — melhor um app
  separado pro SaaS).
- **Mercado Pago**: criar aplicação OAuth pra conectar contas de vendedores.
- **Jurídico:** Termos de Uso + Política de Privacidade (LGPD). Você vai guardar
  dado financeiro de terceiros — isso é obrigatório antes de vender.

## 7. Checklist "não quebrar a main"

- [ ] Nunca commitar mudança de SaaS na `main`.
- [ ] Nenhuma env var nova do SaaS entra no Vercel do dashboard pessoal.
- [ ] Firebase do SaaS é OUTRO projeto — o `vazxpress-a2350` não é tocado.
- [ ] Bug fix útil pros dois: corrige na `main`, depois traz pro `saas`.
- [ ] Deploy do SaaS sai só do branch `saas`, no Vercel novo.
