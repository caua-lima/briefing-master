// Service Worker do Firebase Messaging, servido em /firebase-messaging-sw.js
// (é o caminho padrão que o SDK espera). Gerado dinamicamente porque o
// Service Worker não lê variáveis de ambiente do Next em runtime — só assim
// dá pra reaproveitar o mesmo código em projetos com Firebase diferente
// (este app roda em mais de um deploy, cada um com seu próprio Firebase).
export const dynamic = "force-static";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function GET() {
  const body = `
/**
 * ─── A EXIBIÇÃO VEM PRIMEIRO, E SEM DEPENDER DE REDE ────────────────────
 *
 * Este handler é registrado ANTES de qualquer importScripts, de propósito.
 *
 * Antes, o arquivo começava importando o SDK do Firebase de um CDN
 * (gstatic.com) e só então registrava \`onBackgroundMessage\`. Se aquele
 * download falhasse — rede ruim no celular, CDN bloqueado, o Service Worker
 * acordando offline pra tratar o push — o script inteiro lançava e NENHUM
 * handler chegava a existir. Resultado exato do que foi relatado: a
 * notificação aparecia dentro do app (que usa o SDK da PÁGINA, carregado
 * junto com ela) e nunca na barra do sistema.
 *
 * O evento "push" é da própria plataforma; não precisa de Firebase nenhum
 * pra ser tratado. Registrando aqui em cima, a notificação da barra passa a
 * ser a parte MAIS confiável da cadeia em vez da mais frágil.
 */
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let d = {};
  try {
    const json = event.data.json();
    // O envio manda tudo em "data" (ver lib/push-send.ts); o fallback cobre
    // qualquer mensagem que chegue no formato "notification".
    d = json.data || json.notification || json || {};
  } catch {
    try { d = { title: "Nova venda!", body: event.data.text() }; } catch { d = {}; }
  }

  const title = d.title || "Nova venda!";
  const options = {
    body: d.body || "",
    icon: d.icon || "/manifest-icon-192",
    badge: d.badge || "/manifest-icon-192",
    // A "tag" faz o sistema SUBSTITUIR um aviso já existente do mesmo pedido
    // em vez de empilhar outro — rede de segurança contra push duplicado.
    tag: d.tag || undefined,
    renotify: false,
    /**
     * A notificação FICA na barra até o usuário tocar. Venda é dinheiro: um
     * aviso que some sozinho enquanto o celular está no bolso é um aviso que
     * não aconteceu.
     */
    requireInteraction: true,
    // Guarda o deepLink pro clique (notificationclick não recebe o payload de
    // novo, só o objeto Notification já mostrado) — sem isto, clicar sempre
    // abriria "/" em vez da aba/pedido certo.
    data: { deepLink: d.deepLink || "/" },
  };

  /**
   * Mostra SEMPRE, inclusive com o app aberto.
   *
   * Antes a barra era pulada quando havia aba visível, porque o toast dentro
   * do app já avisava. Só que o toast some sozinho e não deixa registro: com
   * o celular na mão mas a tela em outra aba, ou com o app aberto e o
   * aparelho no bolso, a venda passava sem deixar rastro nenhum. O \`tag\`
   * garante que isso nunca vira duas notificações empilhadas pro mesmo pedido.
   */
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicar na notificação foca a aba do app já aberta (navegando ela pro
// deepLink) ou abre uma nova — nunca as duas coisas, pra não empilhar janela.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const deepLink = (event.notification.data && event.notification.data.deepLink) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(deepLink).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(deepLink);
    }),
  );
});

/**
 * ─── FIREBASE VEM POR ÚLTIMO, E NÃO PODE DERRUBAR NADA ──────────────────
 *
 * O SDK só é necessário para UMA coisa aqui: repassar a mensagem pra página
 * quando o app está aberto, que é o que alimenta o toast interno
 * (onMessage em lib/firebase/push.ts). A notificação da barra já foi tratada
 * acima, sem depender dele.
 *
 * O try/catch é o ponto central: importScripts busca na rede, e Service
 * Worker roda em momentos em que a rede não está garantida — acordando pra
 * tratar um push com o celular em conexão ruim, por exemplo. Sem a proteção,
 * essa falha lançava no topo do arquivo e o Service Worker inteiro morria,
 * levando junto o handler de push que nem precisava do Firebase.
 *
 * NÃO registramos onBackgroundMessage: quem mostra a notificação é o handler
 * nativo acima, sempre. Registrar os dois exibiria o mesmo aviso duas vezes.
 */
try {
  importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-messaging-compat.js");
  firebase.initializeApp(${JSON.stringify(firebaseConfig)});
  firebase.messaging();
} catch (e) {
  // Sem o SDK, o app aberto deixa de receber o toast interno — a notificação
  // da barra, que é a que importa com o celular no bolso, segue funcionando.
}
`.trim();

  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      // Sem isto o SW registrado a partir da rota fica limitado ao escopo
      // implícito do caminho — que já é "/" por ele estar na raiz, mas o
      // header deixa explícito e evita surpresa em algum navegador mais estrito.
      "Service-Worker-Allowed": "/",
    },
  });
}
