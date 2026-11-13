// Dates are handled as local "YYYY-MM-DD" strings (IST for the studio).

export const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s, n) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const todayStr = () => ymd(new Date());

/** Monday of the week containing date s */
export const weekStartOf = (s) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
};
export const weekDates = (monday) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
export const dayKey = (s) => DAY_KEYS[(parseYmd(s).getDay() + 6) % 7];
/** 1 for the first such weekday of the month, 2 for the second … */
export const nthOfMonth = (s) => Math.ceil(parseYmd(s).getDate() / 7);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (s) => {
  if (!s) return "";
  const d = parseYmd(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
export const fmtShort = (s) => {
  const d = parseYmd(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
export const fmtRange = (a, b) => (a === b ? fmtDate(a) : `${fmtShort(a)} – ${fmtDate(b)}`);
export const fmtTs = (ts) => {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const DEFAULT_CALENDAR = {
  workingDays: { mon: "full", tue: "full", wed: "full", thu: "full", fri: "full", sat: "full", sun: "off" },
  offSaturdays: [], // e.g. [2, 4] = 2nd and 4th Saturday off
  standardHours: 9,
  dueTime: "11:00", // timesheet for a week is due the following Monday at this time
};

/** "holiday" | "off" | "half" | "full" for a date, given the calendar */
export function dayType(s, cal) {
  if (cal.holidays && cal.holidays.has(s)) return "holiday";
  const k = dayKey(s);
  if (k === "sat" && (cal.offSaturdays || []).includes(nthOfMonth(s))) return "off";
  return (cal.workingDays && cal.workingDays[k]) || "off";
}

/** Working days a leave/WFH request uses (holidays and off days are skipped) */
export function countRequestDays(from, to, half, cal) {
  if (!from || !to || to < from) return 0;
  let total = 0;
  for (let s = from; s <= to; s = addDays(s, 1)) {
    const t = dayType(s, cal);
    if (t === "full") total += 1;
    else if (t === "half") total += 0.5;
  }
  if (half && from === to && total > 0) total = 0.5;
  return total;
}

export const LEAVE_TYPES = {
  casual: "Casual leave",
  sick: "Sick leave",
  earned: "Earned leave",
  wfh: "Work from home",
};
export const isLeave = (t) => t === "casual" || t === "sick" || t === "earned";

/** Used / pending days per type for a user's requests in a calendar year */
export function leaveUsage(requests, year) {
  const out = {};
  for (const t of Object.keys(LEAVE_TYPES)) out[t] = { used: 0, pending: 0 };
  for (const r of requests) {
    if (!r.from || !r.from.startsWith(String(year))) continue;
    if (r.status === "approved") out[r.type].used += r.days || 0;
    else if (r.status === "pending") out[r.type].pending += r.days || 0;
  }
  return out;
}

export const overlaps = (a1, a2, b1, b2) => a1 <= b2 && b1 <= a2;

// ── Work-from-home weekly limit ───────────────────────────────
export const WFH_PER_WEEK_DEFAULT = 2;
export const wfhLimit = (user) => {
  const v = user?.quotas?.wfhPerWeek;
  return v === undefined || v === null || v === "" ? WFH_PER_WEEK_DEFAULT : Number(v);
};

/** Working days a request covers, split by week: Map(monday -> days) */
export function daysByWeek(from, to, half, cal) {
  const out = new Map();
  if (!from || !to || to < from) return out;
  for (let s = from; s <= to; s = addDays(s, 1)) {
    const t = dayType(s, cal);
    let d = t === "full" ? 1 : t === "half" ? 0.5 : 0;
    if (half && from === to && d > 0) d = 0.5;
    if (d) out.set(weekStartOf(s), (out.get(weekStartOf(s)) || 0) + d);
  }
  return out;
}

/** WFH days already approved or pending, per week: Map(monday -> days) */
export function wfhByWeek(requests, cal, excludeId) {
  const out = new Map();
  for (const r of requests) {
    if (r.type !== "wfh" || r.id === excludeId || (r.status !== "approved" && r.status !== "pending")) continue;
    for (const [w, d] of daysByWeek(r.from, r.to, r.half, cal)) out.set(w, (out.get(w) || 0) + d);
  }
  return out;
}

// ── DOM helpers ───────────────────────────────────────────────
export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, kind = "ok") {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === "error" ? 6000 : 3000);
}

/** Opens a modal. `body` is HTML. Resolves with the form's values (or null if cancelled). */
export function modal({ title, body, okText = "Save", danger = false, onOpen }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <form class="modal" novalidate>
        <h3>${esc(title)}</h3>
        <div class="modal-body">${body}</div>
        <p class="form-error" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-cancel>Cancel</button>
          <button type="submit" class="btn ${danger ? "danger" : "primary"}">${esc(okText)}</button>
        </div>
      </form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector("form");
    const close = (val) => {
      wrap.remove();
      resolve(val);
    };
    wrap.querySelector("[data-cancel]").onclick = () => close(null);
    wrap.addEventListener("mousedown", (e) => {
      if (e.target === wrap) close(null);
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      const data = {};
      for (const el of form.elements) {
        if (!el.name) continue;
        if (el.type === "checkbox") {
          if (el.dataset.group) (data[el.dataset.group] ||= []), el.checked && data[el.dataset.group].push(el.value);
          else data[el.name] = el.checked;
        } else data[el.name] = el.value;
      }
      close(data);
    };
    if (onOpen) onOpen(form);
    const first = form.querySelector("input,select,textarea");
    if (first) first.focus();
  });
}

export const confirmBox = (title, message, okText = "Confirm", danger = false) =>
  modal({ title, body: `<p>${esc(message)}</p>`, okText, danger }).then((v) => v !== null);

export function downloadCsv(filename, rows) {
  const csv = rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
export const round2 = (n) => Math.round(n * 100) / 100;

/** Wraps an async button handler: disables the button while running, shows errors as toasts */
export function busy(btn, fn) {
  return async (...args) => {
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await fn(...args);
    } catch (err) {
      console.error(err);
      toast(friendlyError(err), "error");
    } finally {
      btn.disabled = false;
    }
  };
}

export function friendlyError(err) {
  const code = String(err?.code || "");
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "Wrong username or password.";
  if (code.includes("user-disabled")) return "This account has been deactivated. Please contact an admin.";
  if (code.includes("too-many-requests")) return "Too many attempts. Please wait a few minutes and try again.";
  if (code.includes("permission-denied")) return "You don't have permission to do that.";
  if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  if (code.includes("requires-recent-login")) return "Please sign out and sign in again, then retry.";
  if (code.includes("network")) return "Network error. Check your internet connection.";
  return err?.message || "Something went wrong.";
}

/** Password rule from the BRD: 8+ characters with upper, lower and a number */
export function passwordProblem(pw) {
  if (!pw || pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw))
    return "Password must include an uppercase letter, a lowercase letter and a number.";
  return null;
}
