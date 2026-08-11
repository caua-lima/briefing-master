# Checklist pós-deploy — ZXP Solutions / VAZXPRESS

Checklist prático pra rodar **depois de dar `git push origin main`** e o deploy
subir (Vercel, automático no push). Não é um teste automatizado — é o roteiro
manual mínimo pra confirmar que produção está saudável antes de considerar o
deploy "concluído". Leva ~10-15 minutos.

Ver também: `docs/OPERATIONS_AUDIT.md` (auditoria completa, achados por
severidade) e `docs/FIRESTORE_RULES_DEPLOY.md` (deploy específico de regras).

---

## 0. Antes de tudo: regras do Firestore em dia?

`firestore.rules` é deploy **separado** do app (`firebase deploy --only
firestore:rules` — Vercel não faz isso sozinho). Se você mexeu no arquivo
desde o último deploy de regras, faça isso ANTES de testar qualquer feature
nova que dependa de permissão.

```bash
firebase deploy --only firestore:rules
```

- [ ] `firestore.rules` publicado bate com o do repo (confira em
      **Acesso → Saúde da operação**, seção "Firestore" — compara publicado
      vs. local automaticamente via `firebase-admin`).
- [ ] Se há coleção nova nas regras (ex.: `sync_runs`/`sync_locks` da Fase 4),
      confirmado que o deploy das regras já foi feito — sem isso, a Saúde da
      operação vai mostrar "sem-dados" pra Ads/Cron mesmo com tudo
      funcionando, porque a escrita em `sync_runs` é silenciosamente negada.

## 1. Saúde da operação (visão geral em 1 clique)

Acesse **Acesso → Saúde da operação** (owner-only) e confira que nenhuma
seção está `crítico` sem explicação esperada:

- [ ] **Integração ML** — token presente e não expirado.
- [ ] **Ads** — última coleta com sucesso recente (abra a aba Ads uma vez pra
      gerar o primeiro registro, se acabou de subir a Fase 4).
- [ ] **Repasse Mercado Pago** — sem `sem-dados` numa amostra grande.
- [ ] **Notificações** — pelo menos 1 dispositivo ativo, sem erro recorrente.
- [ ] **Firestore** — regras publicadas == repositório (ver item 0).
- [ ] **Sincronização automática (cron)** — última execução de pedidos e
      devoluções recente (cron roda 03:00 BR todo dia — se acabou de fazer
      deploy fora desse horário, dispare uma sync manual pelo Dashboard pra
      gerar o primeiro registro).

## 2. Números batem (regra de ouro: nunca confiar sem checar uma vez)

- [ ] **Dashboard**: faturamento do dia bate com o que você sabe que vendeu
      (checagem de sanidade, não precisa ser exato ao centavo).
- [ ] **Pedidos**: abrir um pedido recente, conferir que CMV/margem não estão
      zerados pra produto que tem custo cadastrado.
- [ ] **Estoque**: card "Valor em estoque" não mostra aviso de "N sem custo,
      fora deste total" pra produto que você sabe que tem custo lançado (se
      mostrar, é cadastro faltando, não bug).
- [ ] **Ads**: callout de reconciliação ("Esta aba cobre só os N itens
      anunciados...") aparece com números plausíveis, não 0/0.

## 3. Deep links de notificação

- [ ] Clique em "Ver pedido" numa notificação de venda recente → abre direto
      no pedido certo.
- [ ] Feche o drawer manualmente, troque de aba e volte pra Pedidos → **não**
      deve reabrir o mesmo pedido sozinho (bug corrigido na Fase 5 — se
      voltar a acontecer, é regressão).
- [ ] Teste com um pedido antigo (fora do mês atual, se tiver um à mão): deve
      aparecer o aviso "Pedido #X não está no período atual" com botão de
      busca ampliada, não silêncio.

## 4. Notificações não duplicam

- [ ] Atribua uma tarefa a alguém → 1 push, não 2 (checar no dispositivo do
      destinatário, ou em **Notificações** → histórico).
- [ ] Se possível, confirme no Firestore Console que `sync_runs/orders` e
      `sync_runs/claims` têm `lastSuccessAt` recente depois de uma
      sincronização (manual ou cron).

## 5. Mobile (sem credencial de teste automatizado nesta auditoria)

- [ ] Abra o app no celular (ou emulação 375px no navegador) e confira que:
  - tabelas de Pedidos/Estoque/Ads rolam horizontalmente sem vazar da tela;
  - botões de ação em linha de tabela (editar/excluir) são fáceis de tocar;
  - a sidebar abre/fecha pelo hambúrguer sem cobrir conteúdo de forma que
    não dê pra fechar.

## 6. Verificação técnica (deve já estar verde antes do push, mas confirme)

```bash
npx tsc --noEmit
npm run lint
npm run test:critical
npm run build
```

- [ ] Os 4 comandos acima passam sem erro (isso já deveria ter sido
      verificado antes do `git push`, mas confirme se você não foi quem fez
      o deploy).

## 7. Rollback rápido, se algo quebrar

- **App (Vercel):** reverter pro deploy anterior direto no painel da Vercel
  (não precisa de `git revert` pra isso — é instantâneo).
- **Firestore rules:** `git show <commit-anterior>:firestore.rules >
  firestore.rules && firebase deploy --only firestore:rules`, ou reverter
  pelo histórico de versões do Firestore Rules no Console do Firebase.
- **Dado gravado errado:** ver a seção de regras financeiras não-negociáveis
  em `docs/OPERATIONS_AUDIT.md` antes de tentar "corrigir na mão" — CMV e
  custo médio não são triviais de desfazer retroativamente (ver achado sobre
  `deleteMovimento` não recalcular custo médio, Fase 6).

---

## Histórico da auditoria que originou este checklist

Fases 0–10 do plano de auditoria técnica foram executadas entre
2026-08-10 e a data deste commit — ver `docs/OPERATIONS_AUDIT.md` para o
relatório completo por fase (achados, correções aplicadas, testes
adicionados). Resumo rápido do que este checklist cobre e por quê:

| Item do checklist | Fase que motivou |
|---|---|
| Regras do Firestore em dia | Fase 2 (achado A1, bloqueador) |
| Saúde da operação | Fase 1 + Fase 4 (freshness real) |
| Números batem / reconciliação Ads | Fase 3 e 6 |
| Deep links de notificação | Fase 5 |
| Notificações não duplicam | Fase 7 |
| Mobile | Fase 8 (revisão estática, sem login disponível) |
