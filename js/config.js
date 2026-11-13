// ─────────────────────────────────────────────────────────────
//  Ark Tracker configuration — fill these in once (see README)
// ─────────────────────────────────────────────────────────────

// Firebase console → Project settings → General → "Your apps" → Web app → SDK setup (Config)
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCaiX0ybbeuWtk0A4NQCDiBxNcl93SlnRI",
  authDomain: "ark-tracker-6493b.firebaseapp.com",
  projectId: "ark-tracker-6493b",
  storageBucket: "ark-tracker-6493b.firebasestorage.app",
  messagingSenderId: "466981747971",
  appId: "1:466981747971:web:996cbaaab3dda57b5bfd36",
};

// Cloudflare → Workers & Pages → your worker → its URL (no trailing slash)
export const WORKER_URL = "https://ark-tracker-admin.er-ayush-saxena.workers.dev";

// Usernames are turned into login IDs like "rohit.bali@arkstudio.local".
// No email is ever sent. Must match USERNAME_DOMAIN in the worker.
export const USERNAME_DOMAIN = "arkstudio.local";

export const STUDIO_NAME = "The Ark Studio";
export const DEFAULT_EMPLOYEE_PASSWORD = "Ark@2026";
