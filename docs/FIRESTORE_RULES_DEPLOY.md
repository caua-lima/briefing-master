# Deploy do Firestore Rules

`firestore.rules` **nunca** é publicado junto com o deploy do app (Vercel). É um passo manual separado, sempre. Esquecer isso é o erro mais comum do projeto — ver `docs/OPERATIONS_AUDIT.md`, achado A1.

## Como fazer o deploy

```bash
npx firebase-tools login          # uma vez só, ou de novo se a sessão expirou
npx firebase-tools use vazxpress-a2350
npx firebase-tools deploy --only firestore:rules --project vazxpress-a2350
```

Se a saída terminar com `✔  Deploy complete!`, as regras foram publicadas. Se houver erro de sintaxe, o Firebase **rejeita o deploy inteiro** e as regras antigas continuam valendo — não existe deploy parcial/quebrado. Corrija o erro apontado e rode o comando de novo.

## Como conferir se a regra publicada é a atual

Não existe hoje nenhum jeito automático dentro do app de saber isso (é o achado A1 do `OPERATIONS_AUDIT.md` — a Fase 1, Saúde da operação, quando existir, pode mostrar isso). Até lá, confira manualmente:

1. **Console do Firebase** → projeto `vazxpress-a2350` → Firestore Database → aba **Regras**. O editor mostra a data/hora da última publicação no topo. Compare o conteúdo mostrado lá com `git show HEAD:firestore.rules` local — devem ser idênticos.
2. **Pelo comportamento**: depois do deploy, teste os cenários da seção abaixo. Se um colaborador com permissão liberada em Custos consegue salvar um custo, a regra nova está no ar. Se não consegue (erro de permissão no console do navegador, `FirebaseError: Missing or insufficient permissions`), a regra publicada ainda é uma versão antiga.
3. **Histórico de versões**: o Console do Firebase mantém um histórico das últimas publicações de regras (aba Regras → "Histórico"), com timestamp de cada uma — útil pra confirmar QUANDO foi o último deploy sem precisar decorar.

## Cenários de teste — owner

Testar logado como o e-mail que tem `role: "owner"` em `controleAcesso`:

| Cenário | Esperado |
|---|---|
| Editar um custo, uma meta, um produto do estoque | Salva normalmente (owner sempre edita tudo) |
| Abrir Acesso → criar/editar/remover uma entrada de colaborador | Funciona |
| Abrir Acesso → marcar/desmarcar permissão granular (Custos/Metas/Estoque) de um colaborador | Salva |
| Abrir a Central de Notificações, ler a Trilha de Auditoria | Ambas carregam (owner é o único que lê `auditLog`) |
| Editar o próprio nome/foto em "Meu Perfil" | Salva |
| Tentar (via DevTools/console) escrever direto em `ml_tokens` ou `notification_events.title` | Deve ser **rejeitado** mesmo sendo owner — essas coleções são só-backend |

## Cenários de teste — colaborador

Testar logado como um e-mail com `role: "colaborador"`:

| Cenário | Esperado |
|---|---|
| Editar um custo/meta/produto **sem** a aba liberada em `permissoesEdicao` | Rejeitado (`Missing or insufficient permissions`) — e a UI já deveria nem mostrar o botão de salvar habilitado |
| Editar a MESMA aba **depois** de o owner liberar em Acesso | Salva |
| Mover/atribuir uma Tarefa | Sempre funciona, independente de `permissoesEdicao` (Tarefas é compartilhado por design) |
| Editar o próprio nome/foto em "Meu Perfil" | Salva |
| Tentar mudar o próprio `role` pra `"owner"` (via chamada direta, não pela UI) | Rejeitado — nenhuma regra de auto-atualização permite tocar em `role` |
| Tentar mudar a própria `permissoesEdicao` pra se autoconceder acesso | Rejeitado — mesma razão |
| Abrir a aba Acesso | Não deve nem aparecer na navegação; se forçado por URL, a leitura de outros registros de `controleAcesso` falha (`allow list: if isOwner()`) |
| Tentar ler `auditLog` | Rejeitado — só owner lê |
| Marcar uma notificação como lida (própria) | Salva |
| Tentar marcar a notificação como lida **em nome de outro e-mail** (chamada manual manipulada) | Rejeitado desde a correção da Fase 2 (`isSelfReadOrDismissUpdate`) |

## Rollback

Se o deploy mais recente causou um problema (ex.: uma regra nova ficou restritiva demais e ninguém consegue mais salvar):

```bash
# 1. Ache o commit anterior que tinha a versão que funcionava
git log --oneline -- firestore.rules

# 2. Restaure só o arquivo de regras daquele commit (não mexe no resto do working tree)
git show <hash-do-commit-anterior>:firestore.rules > firestore.rules

# 3. Deploy de novo
npx firebase-tools deploy --only firestore:rules --project vazxpress-a2350

# 4. Depois de confirmar que voltou a funcionar, decida se reaplica a mudança nova
#    (git checkout HEAD -- firestore.rules) com o problema corrigido, ou investiga
#    o que especificamente quebrou antes de tentar de novo.
```

Alternativa sem git: o Console do Firebase (Firestore → Regras → Histórico) permite reverter pra qualquer versão publicada anteriormente com um clique, sem precisar do repositório local — mais rápido em uma emergência, mas o `firestore.rules` do repositório fica desalinhado até alguém sincronizar manualmente depois.

## Depois de QUALQUER alteração em `firestore.rules`

Checklist mínimo antes de considerar a mudança "pronta":

1. `git diff firestore.rules` revisado por leitura — regra de segurança errada não dá erro de compilação, só se comporta errado silenciosamente.
2. Deploy feito (comando acima).
3. Pelo menos 1 cenário owner e 1 cenário colaborador da tabela acima testado manualmente.
4. Se a mudança tocou em uma coleção nova, confirmar que **nenhuma** coleção ficou sem `match` nenhum por descuido (o Firestore nega por padrão, mas é fácil esquecer de cobrir uma coleção nova que o código já está lendo/escrevendo).
