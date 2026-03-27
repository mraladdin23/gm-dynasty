// ─────────────────────────────────────────────────────────
//  GM Dynasty — Firebase Configuration
//  Replace the values below with your Firebase project config.
//  This is the SAME Firebase project as SleeperBid —
//  just paste in your existing firebaseConfig object.
//
//  Find it at: Firebase Console → Project Settings → Your Apps
// ─────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// Initialize Firebase (compat v9 SDK — matches SleeperBid)
firebase.initializeApp(firebaseConfig);

// Exported handles — used throughout the app
const auth = firebase.auth();
const db   = firebase.database();

// All GM Dynasty data lives under gmd/ — completely separate
// from your existing SleeperBid nodes (leagues/, users/, etc.)
const GMD = db.ref("gmd");
