// Loopline service worker
//
// Two jobs:
//
// 1. (original) Some browsers (notably Android Chrome) refuse to let a page
//    call `new Notification()` directly and instead require notifications
//    to be shown through a service worker's registration.showNotification().
//    Having this file registered unlocks that path - used for alerts while
//    the page is still open somewhere (tab in background, app unfocused).
//
// 2. (new) True background push using the standard Web Push API - a small
//    free server (see push-server/) sends a push message straight to the
//    browser's push service, which delivers it to this service worker even
//    if every Loopline tab is closed and the browser itself isn't running
//    (the OS/browser wakes it just for this). No Firebase Cloud Messaging
//    and no billing involved - this is a plain web standard supported by
//    every major browser.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Fires when the push server sends a message via web-push, whether or not
// any Loopline tab/window is open.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'Loopline';
  const options = {
    body: data.body || '',
    tag: data.channelId ? ('gc-' + data.channelId) : undefined,
    // Without this, a second push sharing the same tag (i.e. another
    // message in a channel that already has a shown-but-undismissed
    // notification) silently replaces it - no banner, no sound, no
    // re-alert - which looks exactly like "notifications stopped working"
    // after the first one. renotify makes every push actually alert.
    renotify: !!data.channelId,
    data: { channelId: data.channelId },
  };
  event.waitUntil(self.registration.showNotification(title, options));
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
