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
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const title = n.title || "Nova venda!";
  // A "tag" faz o sistema SUBSTITUIR um aviso já existente do mesmo pedido
  // em vez de empilhar outro — rede de segurança contra push duplicado.
  const tag = n.tag || (payload.fcmOptions && payload.fcmOptions.analyticsLabel) || undefined;
  const options = {
    body: n.body || "",
    icon: "/manifest-icon-192",
    badge: "/manifest-icon-192",
    tag: tag,
    renotify: false,
  };
  self.registration.showNotification(title, options);
});

// Clicar na notificação foca a aba do app já aberta, ou abre uma nova.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
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
