// ─────────────────────────────────────────────────────────
//  GM Dynasty — Firebase Configuration
//  Replace the values below with your Firebase project config.
//  This is the SAME Firebase project as SleeperBid —
//  just paste in your existing firebaseConfig object.
//
//  Find it at: Firebase Console → Project Settings → Your Apps
// ─────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey: "AIzaSyC6hhUjpTI2gYVgLW2Ru4-CYSjgKKyJ3Ek",
  authDomain: "sleeperbid.firebaseapp.com",
  databaseURL: "https://sleeperbid-default-rtdb.firebaseio.com",
  projectId: "sleeperbid",
  storageBucket: "sleeperbid.firebasestorage.app",
  messagingSenderId: "81288888200",
  appId: "1:81288888200:web:2e3b4c28250fc2da7b043d",
  measurementId: "G-ZKZ73PRXVS"
};

// Initialize Firebase (compat v9 SDK — matches SleeperBid)
firebase.initializeApp(firebaseConfig);

// ── Force long-polling — stops WebSocket ERR_INTERNET_DISCONNECTED ──
// Must be called before any .ref() listeners are attached.
// experimentalForceLongPolling skips WebSocket entirely and uses
// HTTP long-polling, which works on all networks including those
// that block wss:// connections.
const db = firebase.database();
db.settings({
  experimentalForceLongPolling: true,
  useFetchStreams: false
});

// Exported handles — used throughout the app
const auth = firebase.auth();

// All GM Dynasty data lives under gmd/ — completely separate
// from your existing SleeperBid nodes (leagues/, users/, etc.)
const GMD = db.ref("gmd");
