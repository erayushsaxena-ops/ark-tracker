/**
 * Ark Tracker — admin helper (Cloudflare Worker, free plan)
 *
 * Does the few things Firebase's free plan can't do from a browser:
 * create logins, set another user's password, disable/enable and delete logins.
 * Every call must come from a signed-in, active admin of the tracker.
 *
 * Environment variables (Worker → Settings → Variables and Secrets):
 *   SERVICE_ACCOUNT_JSON  (secret)  Firebase service-account key JSON, pasted whole
 *   FIREBASE_API_KEY      (text)    the web apiKey from js/config.js
 *   ALLOWED_ORIGINS       (text)    e.g. https://yourname.github.io  (comma-separated, or * while testing)
 *   USERNAME_DOMAIN       (text)    optional, defaults to arkstudio.local — must match js/config.js
 *   BOOTSTRAP_SECRET      (secret)  optional; only needed once for setup.html, then delete it
 */

let cachedToken = null; // { token, exp }

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Not found" }, 404, cors);
    if (!cors["Access-Control-Allow-Origin"]) return json({ error: "Origin not allowed" }, 403, cors);

    try {
      const sa = JSON.parse(env.SERVICE_ACCOUNT_JSON || "{}");
      if (!sa.client_email || !sa.private_key) throw httpError(500, "Worker is missing SERVICE_ACCOUNT_JSON.");
      const ctx = { env, sa, projectId: sa.project_id, domain: (env.USERNAME_DOMAIN || "arkstudio.local").toLowerCase() };
      const path = new URL(request.url).pathname.replace(/\/+$/, "");
      const body = await request.json().catch(() => ({}));

      if (path === "/bootstrap") return json(await bootstrap(ctx, body), 200, cors);

      const admin = await requireAdmin(ctx, request);
      switch (path) {
        case "/createUser":
          return json(await createUser(ctx, body), 200, cors);
        case "/setPassword":
          requireUid(body);
          if (!body.password || String(body.password).length < 6) throw httpError(400, "Password must be at least 6 characters.");
          await idt(ctx, "accounts:update", { localId: body.uid, password: String(body.password) });
          return json({ ok: true }, 200, cors);
        case "/setDisabled":
          requireUid(body);
          if (body.uid === admin.uid) throw httpError(400, "You can't deactivate yourself.");
          if (body.disabled) await guardLastAdmin(ctx, body.uid);
          await idt(ctx, "accounts:update", { localId: body.uid, disableUser: !!body.disabled });
          return json({ ok: true }, 200, cors);
        case "/deleteUser":
          requireUid(body);
          if (body.uid === admin.uid) throw httpError(400, "You can't remove yourself.");
          await guardLastAdmin(ctx, body.uid);
          await idt(ctx, "accounts:delete", { localId: body.uid }).catch((e) => {
            if (!/USER_NOT_FOUND/.test(e.message)) throw e;
          });
          return json({ ok: true }, 200, cors);
        default:
          return json({ error: "Not found" }, 404, cors);
      }
    } catch (err) {
      return json({ error: err.message || "Server error" }, err.status || 500, cors);
    }
  },
};

// ── Request helpers ──────────────────────────────────────────

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes("*") || allowed.includes(origin);
  const h = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (ok && origin) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function requireUid(body) {
  if (!body.uid || typeof body.uid !== "string") throw httpError(400, "Missing user id.");
}

const cleanUsername = (u) => {
  const s = String(u || "").trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(s)) throw httpError(400, `Invalid username "${s}". Use 3–40 letters, numbers, dots, dashes or underscores.`);
  return s;
};

// ── Auth: who is calling? ────────────────────────────────────

async function requireAdmin(ctx, request) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw httpError(401, "Not signed in.");
  // Google validates the ID token for us and returns the account it belongs to.
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${ctx.env.FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token }),
  });
  const data = await res.json().catch(() => ({}));
  const user = data.users?.[0];
  if (!res.ok || !user || user.disabled) throw httpError(401, "Your session has expired. Please sign in again.");
  const profile = await fsGet(ctx, `users/${user.localId}`);
  if (!profile || profile.role !== "admin" || profile.active === false) throw httpError(403, "Only admins can do this.");
  return { uid: user.localId, ...profile };
}

async function guardLastAdmin(ctx, uid) {
  const target = await fsGet(ctx, `users/${uid}`);
  if (!target || target.role !== "admin") return;
  const admins = await fsQueryEq(ctx, "users", "role", "admin");
  const others = admins.filter((a) => a.id !== uid && a.active !== false && !a.deleted);
  if (others.length === 0) throw httpError(400, "You can't remove or deactivate the last admin.");
}

// ── Google service-account access token ──────────────────────

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc(header)}.${enc(claims)}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToBytes(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${unsigned}.${b64url(new Uint8Array(sig))}`,
  });
  const data = await res.json();
  if (!res.ok) throw httpError(500, `Google auth failed: ${data.error_description || data.error || res.status}`);
  cachedToken = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return cachedToken.token;
}

function pemToBytes(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Firebase Auth admin calls (Identity Toolkit) ─────────────

async function idt(ctx, method, body) {
  const token = await accessToken(ctx.sa);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${ctx.projectId}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `Auth error ${res.status}`;
    if (msg.startsWith("EMAIL_EXISTS") || msg.startsWith("DUPLICATE_EMAIL")) throw httpError(409, "That username already exists.");
    if (msg.startsWith("WEAK_PASSWORD")) throw httpError(400, "Password must be at least 6 characters.");
    throw httpError(res.status === 400 ? 400 : 500, msg);
  }
  return data;
}

async function createUser(ctx, body) {
  const username = cleanUsername(body.username);
  if (!body.password || String(body.password).length < 6) throw httpError(400, "Password must be at least 6 characters.");
  const data = await idt(ctx, "accounts", {
    email: `${username.toLowerCase()}@${ctx.domain}`,
    password: String(body.password),
    displayName: String(body.displayName || username).slice(0, 100),
    emailVerified: true,
  });
  return { uid: data.localId };
}

// ── Firestore REST helpers ───────────────────────────────────

const fsBase = (ctx) => `https://firestore.googleapis.com/v1/projects/${ctx.projectId}/databases/(default)/documents`;

async function fsGet(ctx, path) {
  const token = await accessToken(ctx.sa);
  const res = await fetch(`${fsBase(ctx)}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  const data = await res.json();
  if (!res.ok) throw httpError(500, `Database error: ${data.error?.message || res.status}`);
  return fromFields(data.fields || {});
}

async function fsSet(ctx, path, obj) {
  const token = await accessToken(ctx.sa);
  const res = await fetch(`${fsBase(ctx)}/${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields: toFields(obj) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw httpError(500, `Database error: ${data.error?.message || res.status}`);
  }
}

async function fsQueryEq(ctx, collectionId, field, value) {
  const token = await accessToken(ctx.sa);
  const res = await fetch(`${fsBase(ctx)}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: toValue(value) } },
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw httpError(500, `Database error: ${data[0]?.error?.message || data.error?.message || res.status}`);
  return data.filter((r) => r.document).map((r) => ({ id: r.document.name.split("/").pop(), ...fromFields(r.document.fields || {}) }));
}

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}
const toFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));

function fromValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
  return null;
}
const fromFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));

// ── One-time setup ───────────────────────────────────────────

async function bootstrap(ctx, body) {
  const secret = ctx.env.BOOTSTRAP_SECRET;
  if (!secret) throw httpError(403, "Setup is turned off (no BOOTSTRAP_SECRET on the worker).");
  if (body.secret !== secret) throw httpError(403, "Wrong setup secret.");
  const admins = (await fsQueryEq(ctx, "users", "role", "admin")).filter((a) => a.active !== false && !a.deleted);
  if (admins.length) throw httpError(409, "Setup has already been done — an admin exists. Add more people from the Employees page.");
  const list = Array.isArray(body.users) ? body.users : [];
  if (!list.some((u) => u.role === "admin")) throw httpError(400, "Include at least one admin.");

  const results = [];
  for (const u of list) {
    try {
      const username = cleanUsername(u.username);
      const { uid } = await createUser(ctx, { username, password: u.password, displayName: u.name });
      await fsSet(ctx, `users/${uid}`, {
        username,
        name: String(u.name || username),
        designation: String(u.designation || ""),
        joiningDate: String(u.joiningDate || ""),
        role: u.role === "admin" ? "admin" : "employee",
        quotas: {
          casual: Number(u.quotas?.casual ?? 12),
          sick: Number(u.quotas?.sick ?? 6),
          earned: Number(u.quotas?.earned ?? 12),
        },
        active: true,
        mustChangePassword: u.mustChangePassword !== false,
        createdAt: new Date(),
      });
      results.push({ username, ok: true });
    } catch (e) {
      results.push({ username: u.username, ok: false, error: e.message });
    }
  }
  return { results };
}
