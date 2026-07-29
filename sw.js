// Loopline service worker
//
// This exists for exactly one reason: some browsers (notably Android
// Chrome) refuse to let a page call `new Notification()` directly and
// instead require notifications to be shown through a service worker's
// registration.showNotification(). Having this file registered is what
// unlocks that path - there's no offline caching or push-from-server
// here, just background notification support for messages the page
// itself is already aware of (it still needs to be open in a tab/rendered
// in the background, just not focused).

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Clicking a notification focuses/opens the app and hands the channel id
// back to the page so it can jump straight to the right channel.
self.addEventListener('notificationclick', (event) => {
  const channelId = event.notification.data && event.notification.data.channelId;
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (channelId) client.postMessage({ type: 'gc-notification-click', channelId });
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
