# GM Dynasty

Your Fantasy Legacy — a social identity platform for dynasty fantasy football managers.

## What It Is

GM Dynasty is a digital locker room where fantasy managers build a customizable profile showcasing their career trophies, league affiliations, and stats across **Sleeper** and **MyFantasyLeague (MFL)** platforms. Managers can interact with each other's lockers via sticky notes, rivalry tracking, and locker tags.

## Stack

- **Frontend**: Vanilla JS SPA — no framework, no build step
- **Hosting**: GitHub Pages (`gh-pages` branch)
- **Auth + DB**: Firebase Realtime Database (`gmd/` node, same project as SleeperBid)
- **APIs**: Sleeper public API + MFL JSON API
- **Deploy**: GitHub Actions on push to `main`

---

## Setup

### 1. Clone & configure Firebase

```bash
git clone https://github.com/YOUR_USER/gm-dynasty.git
cd gm-dynasty
```

Open `firebase/config.js` and replace the placeholder values with your existing Firebase project config:

```js
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  // ...
};
```

This is the **same Firebase project** as SleeperBid. All GM Dynasty data lives under the `gmd/` node.

### 2. Update Firebase Security Rules

In your Firebase console → Realtime Database → Rules, add the `gmd` section from `firebase/schema.js` into your existing rules JSON.

### 3. Deploy

Push to `main` — the GitHub Action handles the rest:

```bash
git add .
git commit -m "Initial GM Dynasty scaffold"
git push origin main
```

Then in your repo: **Settings → Pages → Source: gh-pages branch**.

---

## MFL CORS Proxy

MFL's API doesn't support CORS for browser requests. For development you can use the public `corsproxy.io` proxy (already configured in `js/mfl.js`). For production, deploy the included Cloudflare Worker:

1. Create a free Cloudflare account → Workers
2. Paste `functions/mfl-proxy.js` into a new Worker
3. Deploy and copy your worker URL
4. Update `CORS_PROXY` in `js/mfl.js`

---

## Project Structure

```
gm-dynasty/
├── index.html                  # Single-page app entry
├── firebase/
│   ├── config.js               # Firebase init (fill in your keys)
│   └── schema.js               # DB schema documentation + security rules
├── js/
│   ├── app.js                  # App orchestration, screen management, event handling
│   ├── auth.js                 # Custom username/password auth (wraps Firebase Auth)
│   ├── firebase-db.js          # All gmd/ reads & writes
│   ├── sleeper.js              # Sleeper public API (leagues, rosters, standings)
│   ├── mfl.js                  # MFL JSON API (leagues, rosters, standings)
│   └── profile.js              # Platform linking, league import, locker rendering
├── css/
│   ├── base.css                # Tokens, reset, typography, nav, loading
│   ├── auth.css                # Auth screen styles
│   └── locker.css              # Onboarding + locker + league cards
├── functions/
│   └── mfl-proxy.js            # Cloudflare Worker for MFL CORS proxy
├── assets/
│   ├── icons/
│   └── images/                 # Locker design assets (from collaborator)
└── .github/workflows/
    └── deploy.yml              # GitHub Actions → gh-pages
```

---

## Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Repo scaffold, auth, Sleeper API, MFL API, Firebase schema | ✅ Complete |
| 2 | Locker visual shell, cosmetics, jersey/helmet slots | ⏳ Waiting on design assets |
| 3 | Social layer: sticky notes, DMs, locker tags, rivalry tracking | Planned |
| 4 | Trophy Room: commissioner builder, awards, Hall of Fame, dynasty score | Planned |
| 5 | Media Room: partner marketplace, sponsored lockers | Later |

---

## Username System

GM Dynasty uses its **own username/password** identity — not tied to Sleeper or MFL accounts. After registration, users link their fantasy platform usernames to import leagues and stats. This allows one GM Dynasty account to aggregate history from multiple platforms.

- **Registration**: Choose a GM handle + email + password
- **Platform linking**: Connect Sleeper username, MFL username
- **League import**: Pulls wins/losses/standings/championships automatically
