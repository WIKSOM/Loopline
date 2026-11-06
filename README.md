# Loopline push server

Watches Firebase Realtime Database for new messages and sends Web Push
notifications to everyone allowed to see that channel (except the sender).

## Deploy on Render (free)

1. Put this `push-server/` folder in a GitHub repo.
2. Render → New → Web Service → pick the repo, root directory `push-server`.
3. Build command: `npm install`  ·  Start command: `npm start`
4. Add these environment variables (never commit them):

| Variable | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Full service-account JSON, as one line |
| `FIREBASE_DATABASE_URL` | Your Realtime Database URL |
| `VAPID_PUBLIC_KEY` | From `npx web-push generate-vapid-keys` (must match `PUSH_VAPID_PUBLIC_KEY` in `index.html`) |
| `VAPID_PRIVATE_KEY` | From the same command - keep secret |
| `VAPID_CONTACT_EMAIL` | e.g. `mailto:you@example.com` |

## Keeping it awake (important)

Render's free tier sleeps after ~15 minutes without incoming HTTP requests.
While asleep, **no pushes are sent.** The server pings itself every 10 minutes
to stay up, but if it ever sleeps you need an outside pinger to wake it:

1. Make a free account at uptimerobot.com.
2. Add an HTTP(s) monitor for `https://<your-service>.onrender.com/healthz`
   with a 5-minute interval.

## Database tips

- Add `".indexOn": ["ts"]` under `channels/$channelId/messages` in your
  Realtime Database rules so the `orderByChild('ts')` queries are efficient.
- Only one device per person is stored (`pushSubscriptions/<name>`); the most
  recently active device wins.

## iPhone / iPad

Web Push on iOS/iPadOS (16.4+) only works when Loopline is added to the Home
Screen (Share → Add to Home Screen) and opened from that icon. Turn the bell
on inside the app and accept the permission prompt.
