import { db, doc, setDoc, deleteDoc, serverTimestamp, audit } from "../fb.js";
import { $, $$, esc, toast, busy, confirmBox, modal, downloadCsv, DAY_KEYS, DAY_LABELS, fmtDate, dayType, addDays, num } from "../util.js";

let viewYear = new Date().getFullYear();

export async function render(el, ctx) {
  await ctx.reloadCalendar();
  const cal = ctx.cal;
  const holidays = cal.holidayList.filter((h) => h.date.startsWith(String(viewYear)));
  const ord = ["1st", "2nd", "3rd", "4th", "5th"];

  // Working-day count for the current month, as a quick sanity check
  const now = new Date();
  const m0 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  let workDays = 0;
  for (let d = m0; d.slice(0, 7) === m0.slice(0, 7); d = addDays(d, 1)) {
    const t = dayType(d, cal);
    workDays += t === "full" ? 1 : t === "half" ? 0.5 : 0;
  }

  el.innerHTML = `
    <h1>Holidays &amp; working days</h1>
    <div class="grid two">
      <section class="card">
        <h3>Working week</h3>
        <form id="week" class="stack">
          <div class="days">${DAY_KEYS.map(
            (k) => `<label>${DAY_LABELS[k]}<select name="${k}">
              ${["full", "half", "off"].map((o) => `<option value="${o}" ${cal.workingDays[k] === o ? "selected" : ""}>${o === "full" ? "Full day" : o === "half" ? "Half day" : "Off"}</option>`).join("")}
            </select></label>`
          ).join("")}</div>
          <fieldset><legend>Saturdays off each month</legend>
            <div class="checks">${[1, 2, 3, 4, 5]
              .map((n) => `<label class="check"><input type="checkbox" name="sat${n}" ${cal.offSaturdays?.includes(n) ? "checked" : ""}> ${ord[n - 1]}</label>`)
              .join("")}</div>
            <p class="muted small">For example, tick 2nd and 4th for alternate Saturdays off. Other Saturdays follow the Saturday setting above.</p>
          </fieldset>
          <div class="row2">
            <label>Standard hours per full day<input type="number" name="standardHours" min="1" max="24" step="0.5" value="${cal.standardHours}"></label>
            <label>Timesheet due (following Monday)<input type="time" name="dueTime" value="${esc(cal.dueTime)}"></label>
          </div>
          <p class="muted small">This month has ${workDays} working day(s) with these settings.</p>
          <button class="btn primary" type="submit">Save working week</button>
        </form>
      </section>
      <section class="card">
        <div class="toolbar">
          <h3>Holidays</h3>
          <div class="week-nav">
            <button class="btn ghost small" data-y="-1">‹</button><strong>${viewYear}</strong><button class="btn ghost small" data-y="1">›</button>
          </div>
        </div>
        <div class="actions" style="margin:0 0 12px">
          <button class="btn" id="bulk">Bulk add holidays</button>
          <button class="btn ghost small" id="tpl">Download template</button>
        </div>
        <form id="hol" class="inline-form">
          <input type="date" name="date" required min="${viewYear}-01-01" max="${viewYear}-12-31">
          <input name="name" required maxlength="60" placeholder="Holiday name, e.g. Diwali">
          <button class="btn primary" type="submit">Add</button>
        </form>
        ${
          holidays.length
            ? `<table class="list"><tbody>${holidays
                .map(
                  (h) => `<tr><td class="nowrap">${fmtDate(h.date)}</td><td class="muted">${DAY_LABELS[DAY_KEYS[(new Date(h.date + "T00:00").getDay() + 6) % 7]]}</td>
                  <td>${esc(h.name)}</td><td><button class="icon-btn" data-del="${h.date}" title="Remove">✕</button></td></tr>`
                )
                .join("")}</tbody></table>`
            : `<p class="muted">No holidays added for ${viewYear}.</p>`
        }
      </section>
    </div>`;

  const refresh = () => render(el, ctx);

  const week = $("#week", el);
  week.onsubmit = (e) => e.preventDefault();
  const saveBtn = $("button[type=submit]", week);
  saveBtn.onclick = busy(saveBtn, async (e) => {
    e.preventDefault();
    const workingDays = Object.fromEntries(DAY_KEYS.map((k) => [k, week[k].value]));
    const offSaturdays = [1, 2, 3, 4, 5].filter((n) => week[`sat${n}`].checked);
    const standardHours = num(week.standardHours.value) || 9;
    await setDoc(doc(db, "settings", "calendar"), {
      workingDays,
      offSaturdays,
      standardHours,
      dueTime: week.dueTime.value || "11:00",
      updatedAt: serverTimestamp(),
    });
    const summary = DAY_KEYS.map((k) => `${DAY_LABELS[k]} ${workingDays[k]}`).join(", ");
    const sats = offSaturdays.length ? ` · Saturdays off: ${offSaturdays.map((n) => ord[n - 1]).join(", ")}` : "";
    await audit(ctx.profile, "Updated working week", `${summary}${sats} · ${standardHours} h/day`);
    toast("Working week saved.");
    refresh();
  });

  const hol = $("#hol", el);
  hol.onsubmit = (e) => e.preventDefault();
  const addBtn = $("button", hol);
  addBtn.onclick = busy(addBtn, async (e) => {
    e.preventDefault();
    if (!hol.reportValidity()) return;
    const date = hol.date.value;
    const name = hol.name.value.trim();
    await setDoc(doc(db, "holidays", date), { date, name, createdAt: serverTimestamp() });
    await audit(ctx.profile, "Added holiday", `${date} ${name}`);
    toast("Holiday added.");
    refresh();
  });

  $("#tpl", el).onclick = () =>
    downloadCsv(`holidays_${viewYear}_template.csv`, [
      ["Date", "Holiday"],
      [`${viewYear}-01-26`, "Republic Day"],
      [`${viewYear}-08-15`, "Independence Day"],
      [`${viewYear}-10-02`, "Gandhi Jayanti"],
      [`${viewYear}-12-25`, "Christmas"],
    ]);

  const bulk = $("#bulk", el);
  bulk.onclick = busy(bulk, async () => {
    let parsed = { rows: [], errors: [] };
    const v = await modal({
      title: "Bulk add holidays",
      okText: "Add holidays",
      body: `
        <p class="muted small">One holiday per line: <b>date</b> and <b>name</b>, separated by a comma or tab. You can copy two columns straight from Excel or Google Sheets.
        Dates can be <b>2026-03-04</b>, <b>04/03/2026</b>, <b>04-03-2026</b> (day first) or <b>4 Mar 2026</b>.</p>
        <label>Upload a CSV file (optional)<input type="file" name="file" accept=".csv,.txt,text/csv,text/plain"></label>
        <label>Or paste the list<textarea name="text" rows="10" spellcheck="false" placeholder="2026-01-26, Republic Day&#10;04/03/2026, Holi&#10;15 Aug 2026, Independence Day"></textarea></label>
        <div class="bulk-preview muted small"></div>`,
      onOpen: (form) => {
        const box = $(".bulk-preview", form);
        const show = () => {
          parsed = parseHolidays(form.text.value);
          const existing = new Set(cal.holidayList.map((h) => h.date));
          const upd = parsed.rows.filter((r) => existing.has(r.date)).length;
          box.innerHTML = !form.text.value.trim()
            ? ""
            : `<b>${parsed.rows.length}</b> holiday(s) ready${upd ? ` (${upd} will update an existing name)` : ""}.` +
              (parsed.rows.length
                ? `<div class="bulk-list">${parsed.rows.map((r) => `${fmtDate(r.date)} — ${esc(r.name)}`).join("<br>")}</div>`
                : "") +
              (parsed.errors.length ? `<div class="warn">Skipped ${parsed.errors.length} line(s):<br>${parsed.errors.map(esc).join("<br>")}</div>` : "");
        };
        form.text.addEventListener("input", show);
        form.file.addEventListener("change", async () => {
          const f = form.file.files[0];
          if (!f) return;
          form.text.value = (await f.text()).replace(/^\ufeff/, "");
          show();
        });
      },
    });
    if (!v) return;
    parsed = parseHolidays(v.text);
    if (!parsed.rows.length) throw new Error("No valid holidays found. Check the dates and try again.");
    for (const r of parsed.rows) await setDoc(doc(db, "holidays", r.date), { date: r.date, name: r.name, createdAt: serverTimestamp() });
    await audit(ctx.profile, "Bulk added holidays", `${parsed.rows.length} holiday(s): ${parsed.rows[0].date} → ${parsed.rows.at(-1).date}`);
    const yr = parsed.rows[0].date.slice(0, 4);
    if (parsed.rows.every((r) => r.date.startsWith(yr))) viewYear = Number(yr);
    toast(`${parsed.rows.length} holiday(s) added.${parsed.errors.length ? ` ${parsed.errors.length} line(s) skipped.` : ""}`);
    refresh();
  });

  $$("[data-y]", el).forEach((b) => (b.onclick = () => ((viewYear += Number(b.dataset.y)), refresh())));
  $$("[data-del]", el).forEach((b) => {
    b.onclick = busy(b, async () => {
      if (!(await confirmBox("Remove holiday", `Remove the holiday on ${fmtDate(b.dataset.del)}?`, "Remove", true))) return;
      await deleteDoc(doc(db, "holidays", b.dataset.del));
      await audit(ctx.profile, "Removed holiday", b.dataset.del);
      toast("Removed.");
      refresh();
    });
  });
}

// ── Bulk holiday parsing ─────────────────────────────────────
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const two = (n) => String(n).padStart(2, "0");
function toIso(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d);
  if (!y || dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${two(m)}-${two(d)}`;
}
export function parseDate(raw) {
  const s = String(raw || "").trim().replace(/^"|"$/g, "");
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return toIso(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) return toIso(m[3], m[2], m[1]); // day first (India)
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})[,\s-]+(\d{2,4})$/))) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mo ? toIso(m[3], mo, m[1]) : null;
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})$/))) {
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mo ? toIso(m[3], mo, m[2]) : null;
  }
  return null;
}
export function parseHolidays(text) {
  const rows = [];
  const errors = [];
  const seen = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let parts = t.includes("\t") ? t.split("\t") : t.split(",");
    // "4 Mar, 2026, Holi" — rejoin a date that contains a comma
    let date = parseDate(parts[0]);
    let rest = parts.slice(1);
    if (!date && parts.length > 2) {
      date = parseDate(parts[0] + " " + parts[1]);
      rest = parts.slice(2);
    }
    const name = rest.join(",").trim().replace(/^"|"$/g, "").trim();
    if (!date) {
      if (!/^date\b/i.test(t)) errors.push(`“${t}” — date not recognised`);
      continue;
    }
    if (!name) {
      errors.push(`“${t}” — missing holiday name`);
      continue;
    }
    seen.set(date, { date, name: name.slice(0, 60) });
  }
  rows.push(...[...seen.values()].sort((a, b) => a.date.localeCompare(b.date)));
  return { rows, errors };
}
