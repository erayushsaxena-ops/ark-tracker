import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FIREBASE_CONFIG, WORKER_URL, USERNAME_DOMAIN } from "./config.js";
import { DEFAULT_CALENDAR } from "./util.js";

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

export {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  serverTimestamp,
};

export const usernameToEmail = (u) => `${String(u).trim().toLowerCase()}@${USERNAME_DOMAIN}`;

/** Calls the admin Cloudflare Worker with the signed-in admin's token */
export async function callWorker(path, body) {
  const token = await auth.currentUser.getIdToken();
  let res;
  try {
    res = await fetch(WORKER_URL.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the admin service. Check WORKER_URL in js/config.js.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Admin service error (${res.status})`);
  return json;
}

const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export async function listAll(col) {
  return docs(await getDocs(collection(db, col)));
}
export async function listWhere(col, field, op, value) {
  return docs(await getDocs(query(collection(db, col), where(field, op, value))));
}

/** Working-day settings + holidays, merged with defaults */
export async function loadCalendar() {
  const [settingsSnap, holidays] = await Promise.all([getDoc(doc(db, "settings", "calendar")), listAll("holidays")]);
  const s = settingsSnap.exists() ? settingsSnap.data() : {};
  return {
    ...DEFAULT_CALENDAR,
    ...s,
    workingDays: { ...DEFAULT_CALENDAR.workingDays, ...(s.workingDays || {}) },
    holidays: new Map(holidays.map((h) => [h.date, h.name])),
    holidayList: holidays.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export async function loadProjects() {
  const list = await listAll("projects");
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export const INTERNAL_PROJECT = { id: "_internal", name: "Internal / Admin", code: "INT", status: "active" };

export async function audit(actor, action, details = "") {
  try {
    await addDoc(collection(db, "audit"), {
      at: serverTimestamp(),
      actorUid: actor.uid,
      actor: actor.username,
      action,
      details,
    });
  } catch (e) {
    console.warn("audit failed", e);
  }
}
