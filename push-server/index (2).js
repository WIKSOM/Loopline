/**
 * Loopline push server
 * -----------------------------------------------------------------------
 * A small, always-on, FREE server that:
 *   1. Watches your Firebase Realtime Database for new chat messages.
 *   2. Sends a real push notification to everyone (except the sender) via
 *      the standard Web Push protocol - no Firebase Cloud Messaging, no
 *      Google billing, no credit card required anywhere in this chain.
 *
 * Runs happily on Render.com's free web service tier (or Fly.io, Railway,
 * etc.) - see push-server/README.md for exact deploy steps.
 *
 * ENVIRONMENT VARIABLES (set these in Render's dashboard, never commit them):
 *   FIREBASE_SERVICE_ACCOUNT   the full JSON contents of your service
 *                              account key, as a single-line string
 *   FIREBASE_DATABASE_URL      e.g. https://group-chat-5bea9-default-rtdb.asia-southeast1.firebasedatabase.app
 *   VAPID_PUBLIC_KEY           from `npx web-push generate-vapid-keys`
 *   VAPID_PRIVATE_KEY          from the same command - keep secret
 *   VAPID_CONTACT_EMAIL        any contact email, e.g. mailto:you@example.com
 */

const express = require('express');
const webpush = require('web-push');
const admin = require('firebase-admin');

const {
  FIREBASE_SERVICE_ACCOUNT,
  FIREBASE_DATABASE_URL,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_CONTACT_EMAIL,
  PORT = 3000,
} = process.env;

if (!FIREBASE_SERVICE_ACCOUNT || !FIREBASE_DATABASE_URL || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Missing required environment variables. See the comment at the top of index.js.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)),
  databaseURL: FIREBASE_DATABASE_URL,
});

webpush.setVapidDetails(
  VAPID_CONTACT_EMAIL || 'mailto:admin@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const db = admin.database();

// Mirrors the client's keySafe() so we can match/skip the sender's own
// subscription(s) by the same key used to store them.
function keySafe(name) {
  return String(name).replace(/[.#$/\[\]]/g, '_');
}

// A presence record older than this is treated as stale (tab closed, or
// browser killed without a clean unload) - err on the side of still
// sending a push rather than silently going quiet for someone.
const PRESENCE_STALE_MS = 25000;

async function pushToEveryoneExcept(senderName, channelId, title, body) {
  const senderKey = keySafe(senderName);
  const [subsSnap, presenceSnap] = await Promise.all([
    db.ref('pushSubscriptions').get(),
    db.ref('activePresence').get(),
  ]);
  const subsByUser = subsSnap.val() || {};
  const presenceByUser = presenceSnap.val() || {};

  const payload = JSON.stringify({ title, body, channelId: String(channelId) });
  const staleKeys = [];
  const now = Date.now();

  await Promise.all(
    Object.entries(subsByUser).map(async ([userKey, entry]) => {
      if (userKey === senderKey || !entry || !entry.subscription) return;

      // Skip the push if this person is actively looking at this exact
      // channel right now - the page's own realtime listener already
      // handles that case (toast/sound), a push on top would be a
      // duplicate. Anyone not "fresh enough" in presence (tab closed,
      // backgrounded, different channel) still gets the push.
      const presence = presenceByUser[userKey];
      const presenceFresh = presence && (now - presence.ts) < PRESENCE_STALE_MS;
      if (presenceFresh && presence.active && presence.channel === channelId) return;

      try {
        await webpush.sendNotification(entry.subscription, payload);
      } catch (err) {
        // 404/410 = the browser unsubscribed or the subscription expired -
        // clean it up so we stop trying every time.
        if (err.statusCode === 404 || err.statusCode === 410) {
          staleKeys.push(userKey);
        } else {
          console.warn(`Push failed for ${userKey}:`, err.statusCode, err.body || err.message);
        }
      }
    })
  );

  await Promise.all(staleKeys.map((k) => db.ref('pushSubscriptions').child(k).remove()));
}

function previewFor(message) {
  switch (message.type) {
    case 'gif': return 'Sent a GIF';
    case 'video': return 'Sent a video';
    case 'photo': return 'Sent a photo';
    case 'audio': return 'Sent a voice message';
    case 'poll': return '\ud83d\udcca ' + ((message.poll && message.poll.question) || 'Poll');
    case 'emoji': return message.text || '';
    default: return (message.text || '').slice(0, 120);
  }
}

// ---- Watch every channel for new messages ----
// Realtime Database doesn't support a single "any new message anywhere"
// listener the way Cloud Functions triggers do, so we watch the channel
// list and attach one listener per channel, same approach the client uses.
const channelWatchers = new Map();
const startedAt = Date.now();

function watchChannel(channelId) {
  if (channelWatchers.has(channelId)) return;
  const ref = db.ref(`channels/${channelId}/messages`).orderByChild('ts').startAt(startedAt);
  ref.on('child_added', async (snap) => {
    const message = snap.val();
    if (!message || !message.user) return;
    try {
      const nameSnap = await db.ref('channelNames').child(channelId).get();
      const channelName = nameSnap.val() || channelId;
      await pushToEveryoneExcept(
        message.user,
        channelId,
        `${message.user} in #${channelName}`,
        previewFor(message)
      );
    } catch (err) {
      console.error('Error handling new message:', err);
    }
  });
  channelWatchers.set(channelId, ref);
}

db.ref('channelNames').on('value', (snap) => {
  const names = snap.val() || {};
  Object.keys(names).forEach(watchChannel);
});

// ---- Tiny HTTP server, mostly so Render sees the service as "up" ----
const app = express();
app.get('/', (_req, res) => res.send('Loopline push server is running.'));
app.listen(PORT, () => console.log(`Loopline push server listening on port ${PORT}`));
