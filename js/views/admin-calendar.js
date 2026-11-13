import { db, doc, setDoc, deleteDoc, serverTimestamp, audit } from "../fb.js";
import { $, $$, esc, toast, busy, confirmBox, DAY_KEYS, DAY_LABELS, fmtDate, dayType, addDays, num } from "../util.js";

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
