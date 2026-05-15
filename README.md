# Briefing - Next.js + Firebase

Guia direto para instalar e configurar Firebase neste projeto, localmente e em deploy (Vercel ou Firebase Hosting).

## 1. Requisitos

- Node.js 20+
- Conta Google com acesso ao projeto Firebase `vazxpress-a2350` (substitua pelo nome do seu projeto se for um fork)
- npm

## 2. Instalar dependencias do projeto

```bash
npm install
firebase login
```
- Se não conseguir acessar projeto, peça acesso ao dono do projeto ou confirme que esta logado com a conta correta (`firebase login --reauth` para forçar escolha de conta).
## 3. Configurar variaveis de ambiente

Crie ou ajuste arquivo `.env.local` na raiz com estas chaves:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=vazxpress-a2350
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

Obs:
- Prefixo `NEXT_PUBLIC_` expoe variavel no navegador. Isso e esperado para config cliente Firebase.
- Nao coloque credenciais sensiveis (service account, secret admin) neste arquivo.

## 4. Rodar projeto local

```bash
npm run dev
```

Abra `http://localhost:3000`.

## 5. Firebase CLI (para rules, hosting, emulators)

Este projeto ja possui:
- `firebase.json`
- `.firebaserc` com projeto default `vazxpress-a2350`
- `firestore.rules`

### 5.1 Usar CLI sem instalacao global

```bash
npx firebase-tools --version
```

### 5.2 Login no Firebase

```bash
npx firebase-tools login
```

### 5.3 Confirmar projeto alvo

```bash
npx firebase-tools use vazxpress-a2350 ### Aqui deve ser o nome do seu projeto, se nao tiver, rode `npx firebase-tools projects:list` para ver os projetos disponiveis e confirmar o nome correto.
```

### 5.4 Deploy das regras do Firestore

```bash
npx firebase-tools deploy --only firestore:rules --project vazxpress-a2350
```

### 5.5 Emuladores locais (opcional)

```bash
npx firebase-tools emulators:start
```

Se quiser so hosting:

```bash
npx firebase-tools emulators:start --only hosting
```

## 6. Fluxo de acesso (owner primeiro usuario)

Implementacao atual:
- Se bootstrap de acesso ainda nao existe, primeiro login autenticado vira `owner`.
- Owner fica em `controleAcesso` e metadado em `controleAcessoMeta/config`.
- Regras no `firestore.rules` controlam owner/admin/user.

Importante:
- Depois de alterar `firestore.rules`, rode deploy das rules.
- Sem deploy, Firebase continua com regras antigas.

## 7. Deploy na Vercel

## 7.1 Conectar repositorio na Vercel

- Import project na Vercel.
- Framework detectado: Next.js.

## 7.2 Configurar Environment Variables na Vercel

No painel da Vercel, adicione as mesmas variaveis do `.env.local`:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Depois redeploy.

## 7.3 Regras Firestore continuam fora da Vercel

Mesmo com app na Vercel, deploy das regras ainda e via Firebase CLI:

```bash
npx firebase-tools deploy --only firestore:rules --project vazxpress-a2350
```

## 8. Deploy no Firebase Hosting (alternativa a Vercel)

`firebase.json` ja esta com hosting via frameworks.

### 8.1 Deploy

```bash
npx firebase-tools deploy --only hosting --project vazxpress-a2350
```

### 8.2 Deploy completo (hosting + rules)

```bash
npx firebase-tools deploy --project vazxpress-a2350
```

## 9. Troubleshooting rapido

- Erro `firebase is not recognized`:
	use `npx firebase-tools ...`.

- Erro `Not in a Firebase app directory`:
	confirme existencia de `firebase.json` na raiz.

- Erro `Failed to authenticate`:
	rode `npx firebase-tools login`.

- Mudou rules e nada aconteceu:
	faltou deploy de `firestore.rules`.
