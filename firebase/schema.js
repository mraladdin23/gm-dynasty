// ─────────────────────────────────────────────────────────
//  GM Dynasty — Firebase Realtime Database Schema
//  Node: gmd/   (top-level, separate from SleeperBid)
//
//  This file is DOCUMENTATION ONLY — a reference for the
//  shape of every node written/read in the app.
//  Keep this updated as the schema evolves.
// ─────────────────────────────────────────────────────────

/*
gmd/
├── users/
│   └── {gmdUsername}/                     ← sanitized GM Dynasty username (lowercase)
│       ├── uid: "firebase_auth_uid"        ← links to Firebase Auth user
│       ├── username: "CoachKelce"          ← display-form (original casing)
│       ├── email: "user@example.com"
│       ├── createdAt: 1700000000000        ← epoch ms
│       ├── bio: "12-time champion..."
│       ├── favoriteNflTeam: "KC"           ← NFL team abbreviation
│       ├── avatarUrl: ""                   ← future: image upload
│       ├── visibility: {
│       │     profile: "public",            ← public | friends | private
│       │     leagues: "public",
│       │     trophies: "public",
│       │     record: "public",
│       │     trades: "private"
│       │   }
│       │
│       ├── platforms/                      ← linked fantasy platform accounts
│       │   ├── sleeper/
│       │   │   ├── linked: true
│       │   │   ├── sleeperUserId: "123456789"
│       │   │   ├── sleeperUsername: "coach_kelce"
│       │   │   └── linkedAt: 1700000000000
│       │   └── mfl/
│       │       ├── linked: true
│       │       ├── mflUsername: "CoachKelce"
│       │       └── linkedAt: 1700000000000
│       │
│       ├── leagues/                        ← all leagues across all platforms
│       │   └── {leagueKey}/               ← e.g. "sleeper_123456" or "mfl_2024_789"
│       │       ├── platform: "sleeper"     ← sleeper | mfl
│       │       ├── leagueId: "123456"
│       │       ├── leagueName: "The League"
│       │       ├── season: "2024"
│       │       ├── leagueType: "dynasty"   ← dynasty | redraft | keeper
│       │       ├── teamName: "Kelce's Army"
│       │       ├── wins: 9
│       │       ├── losses: 4
│       │       ├── ties: 0
│       │       ├── pointsFor: 1823.45
│       │       ├── pointsAgainst: 1654.22
│       │       ├── standing: 2            ← rank in league
│       │       ├── totalTeams: 12
│       │       ├── isChampion: false
│       │       ├── playoffResult: "finalist" ← champion|finalist|semifinal|miss|null
│       │       └── importedAt: 1700000000000
│       │
│       ├── locker/                         ← Phase 2: cosmetic + visual items
│       │   ├── jersey: { teamCode: "KC", number: "87", style: "home" }
│       │   ├── helmet: { teamCode: "KC", style: "chrome" }
│       │   ├── banner: { text: "Dynasty King", color: "#e31837" }
│       │   ├── items: []                   ← array of equipped cosmetic item IDs
│       │   └── background: "stadium"
│       │
│       └── stats/                          ← aggregated career stats (computed)
│           ├── totalWins: 0
│           ├── totalLosses: 0
│           ├── championships: 0
│           ├── leaguesPlayed: 0
│           ├── winPct: 0.0
│           └── dynastyScore: 0             ← composite career rating (Phase 4)
│
├── social/
│   └── {gmdUsername}/                      ← the locker being interacted with
│       ├── stickyNotes/
│       │   └── {noteId}/
│       │       ├── authorUsername: "RivalGM"
│       │       ├── text: "You got lucky 🤡"
│       │       ├── emoji: "🤡"
│       │       ├── createdAt: 1700000000000
│       │       └── isRemoved: false
│       ├── lockerTags/
│       │   └── {tagId}/
│       │       ├── authorUsername: "RivalGM"
│       │       ├── tagType: "clown"        ← clown|toilet|trophy|rivalry
│       │       └── createdAt: 1700000000000
│       └── reactions/
│           ├── "🔥": 12
│           ├── "🤡": 3
│           └── "👑": 7
│
├── rivalries/
│   └── {userA}_{userB}/                   ← alphabetical order, underscore join
│       ├── userA: "CoachKelce"
│       ├── userB: "RivalGM"
│       ├── recordA: { wins: 7, losses: 4 }
│       ├── recordB: { wins: 4, losses: 7 }
│       ├── sharedLeagues: ["sleeper_123", "mfl_456"]
│       └── lastUpdated: 1700000000000
│
├── messages/                               ← direct messages (Phase 3)
│   └── {conversationId}/                  ← sorted usernames joined
│       └── {messageId}/
│           ├── from: "CoachKelce"
│           ├── text: "GG man"
│           └── createdAt: 1700000000000
│
└── meta/
    ├── totalUsers: 0
    └── lastUpdated: 1700000000000
*/

// ─────────────────────────────────────────────────────────
//  Firebase Security Rules — add to your existing rules
//  under the "gmd" node. Paste inside your existing rules.
// ─────────────────────────────────────────────────────────

/*
"gmd": {
  "users": {
    "$username": {
      ".read": "auth != null && (
        root.child('gmd/users/' + $username + '/visibility/profile').val() === 'public'
        || root.child('gmd/users/' + $username + '/uid').val() === auth.uid
      )",
      ".write": "auth != null && root.child('gmd/users/' + $username + '/uid').val() === auth.uid"
    }
  },
  "social": {
    "$username": {
      "stickyNotes": {
        ".read": "auth != null",
        "$noteId": {
          ".write": "auth != null"
        }
      },
      "lockerTags": {
        ".read": "auth != null",
        "$tagId": {
          ".write": "auth != null"
        }
      },
      "reactions": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  },
  "rivalries": {
    ".read": "auth != null",
    ".write": "auth != null"
  },
  "messages": {
    "$conversationId": {
      ".read": "auth != null && $conversationId.contains(root.child('gmd/users').orderByChild('uid').equalTo(auth.uid).limitToFirst(1).val())",
      ".write": "auth != null"
    }
  },
  "meta": {
    ".read": true,
    ".write": "auth != null"
  }
}
*/
