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

// Initialize Firebase (compat v9 SDK)
firebase.initializeApp(firebaseConfig);

// Exported handles — used throughout the app
const auth = firebase.auth();
const db   = firebase.database();

// All GM Dynasty data lives under gmd/
const GMD = db.ref("gmd");
