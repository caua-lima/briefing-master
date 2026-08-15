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
importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-messaging-compat.js");

firebase.initializeApp(${JSON.stringify(firebaseConfig)});
const messaging = firebase.messaging();

// Notificação chegando com o app FECHADO ou em segundo plano.
//
// O envio manda só "data" (não "notification") DE PROPÓSITO: se a mensagem
// tem um campo "notification" no topo, o próprio SDK do Firebase pode
// exibir a notificação sozinho, em paralelo com o showNotification() manual
// abaixo — duas exibições pra um push só. É um problema conhecido e
// documentado do FCM web. Com "data" puro, só este código decide o que
// aparece na tela; nunca duplica.
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  const title = d.title || "Nova venda!";
  // Selo de produto anunciado tambem na notificacao NATIVA (app fechado) —
  // sem isto o aviso do celular perderia justamente o contexto de Ads que o
  // toast de foreground mostra. Texto deliberadamente "produto anunciado":
  // o ML nao expoe atribuicao por pedido (ver lib/ml/ads-attribution.ts).
  const selo = d.viaAds === "1"
    ? "\\n📣 Produto anunciado" + (d.adsInvestido ? " · R$ " + d.adsInvestido + " em Ads (7 dias)" : "")
    : "";
  // A "tag" faz o sistema SUBSTITUIR um aviso já existente do mesmo pedido
  // em vez de empilhar outro — rede de segurança extra contra push duplicado.
  const options = {
    body: (d.body || "") + selo,
    icon: d.icon || "/manifest-icon-192",
    badge: d.badge || "/manifest-icon-192",
    tag: d.tag || undefined,
    renotify: false,
    // Guarda o deepLink pro clique (notificationclick não recebe o payload de
    // novo, só o objeto Notification já mostrado) — sem isto, clicar sempre
    // abriria "/" em vez da aba/pedido certo.
    data: { deepLink: d.deepLink || "/" },
  };
  self.registration.showNotification(title, options);
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
