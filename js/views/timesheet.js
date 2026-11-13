import { db, doc, getDoc, setDoc, serverTimestamp, loadProjects, listWhere, INTERNAL_PROJECT, audit } from "../fb.js";
import {
  $,
  $$,
  esc,
  toast,
  busy,
  confirmBox,
  todayStr,
  weekStartOf,
  weekDates,
  addDays,
  dayType,
  dayKey,
  DAY_LABELS,
  fmtShort,
  fmtDate,
  fmtTs,
  num,
  round2,
  isLeave,
  LEAVE_TYPES,
} from "../util.js";

export async function render(el, ctx) {
  await renderSheet(el, ctx, { user: ctx.profile, mine: true });
}

/**
 * Weekly timesheet grid.
 * opts.user  – the profile whose sheet is shown
 * opts.mine  – true when the signed-in user is filling their own sheet
 * opts.week  – Monday to open on (defaults to this week)
 * opts.onWeekChange(week) – optional callback for the admin view
 */
export async function renderSheet(el, ctx, opts) {
  let week = opts.week || weekStartOf(todayStr());
  const [projects, requests] = await Promise.all([loadProjects(), listWhere("requests", "uid", "==", opts.user.uid)]);
  const projectList = [INTERNAL_PROJECT, ...projects];
  const projectName = (id) => projectList.find((p) => p.id === id)?.name;

  async function draw() {
    el.innerHTML = `<div class="loading">Loading…</div>`;
    const snap = await getDoc(doc(db, "timesheets", `${opts.user.uid}_${week}`));
    const sheet = snap.exists() ? snap.data() : null;
    const submitted = sheet?.status === "submitted";
    const editable = opts.mine && !submitted;
    const today = todayStr();
    const dates = weekDates(week);
    const cal = ctx.cal;
    const std = num(cal.standardHours) || 9;

    // What each day looks like: holiday / off / leave / WFH
    const info = dates.map((d) => {
      const type = dayType(d, cal);
      const covering = requests.filter((r) => r.status === "approved" && r.from <= d && d <= r.to);
      const leave = covering.find((r) => isLeave(r.type));
      const wfh = covering.find((r) => r.type === "wfh");
      let expected = type === "full" ? std : type === "half" ? std / 2 : 0;
      let badge = "";
      let locked = false;
      if (type === "holiday") (badge = cal.holidays.get(d)), (locked = true);
      else if (type === "off") (badge = "Off"), (locked = true);
      else if (leave && !leave.half) (badge = LEAVE_TYPES[leave.type]), (locked = true), (expected = 0);
      else if (leave && leave.half) (badge = "Half-day leave"), (expected = expected / 2);
      else if (type === "half") badge = "Half day";
      if (wfh && !locked) badge = badge ? `${badge} · WFH` : "WFH";
      if (d > today) locked = true;
      return { d, type, badge, locked, expected, wfh: !!wfh && !locked, cls: type === "holiday" ? "holiday" : leave ? "leave" : wfh ? "wfh" : type };
    });

    let rows = (sheet?.entries || []).map((r) => ({ ...r, hours: { ...(r.hours || {}) } }));
    if (!rows.length) rows = [{ projectId: "", note: "", hours: {} }];

    const activeProjects = projectList.filter((p) => p.status !== "archived");
    const projectOptions = (sel) => {
      let opts2 = activeProjects;
      if (sel && !activeProjects.some((p) => p.id === sel)) opts2 = [...activeProjects, projectList.find((p) => p.id === sel) || { id: sel, name: "(removed project)" }];
      return `<option value="">Choose project…</option>${opts2
        .map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}${p.code ? ` (${esc(p.code)})` : ""}</option>`)
        .join("")}`;
    };

    const rowHtml = (r, i) => `
      <tr data-i="${i}">
        <td class="proj">${
          editable
            ? `<select name="project">${projectOptions(r.projectId)}</select>`
            : esc(projectName(r.projectId) || r.projectName || "—")
        }</td>
        <td class="note">${editable ? `<input name="note" value="${esc(r.note)}" placeholder="What did you work on?" maxlength="200">` : esc(r.note || "")}</td>
        ${info
          .map((x) => {
            const v = r.hours[x.d] || "";
            return `<td class="h ${x.cls}">${
              editable && !x.locked
                ? `<input name="h" data-d="${x.d}" type="number" inputmode="decimal" min="0" max="24" step="0.5" value="${v}">`
                : `<span>${v || ""}</span>`
            }</td>`;
          })
          .join("")}
        <td class="tot" data-rowtot></td>
        ${editable ? `<td><button type="button" class="icon-btn" data-del title="Remove row">✕</button></td>` : ""}
      </tr>`;

    const title = opts.mine ? "My timesheet" : `${esc(opts.user.name || opts.user.username)} — timesheet`;
    el.innerHTML = `
      ${opts.mine ? `<h1>${title}</h1>` : `<h2>${title}</h2>`}
      <div class="toolbar">
        <div class="week-nav">
          <button class="btn ghost small" data-nav="-7">‹ Prev</button>
          <strong>${fmtShort(dates[0])} – ${fmtDate(dates[6])}</strong>
          <button class="btn ghost small" data-nav="7">Next ›</button>
          <button class="btn ghost small" data-nav="0">This week</button>
        </div>
        <span class="status ${submitted ? "ok" : sheet ? "draft" : "none"}">${
          submitted ? `Submitted ${fmtTs(sheet.submittedAt)}` : sheet ? "Draft — not submitted" : "Not started"
        }</span>
      </div>
      <div class="table-scroll">
        <table class="sheet">
          <thead><tr>
            <th>Project</th><th>Task / note</th>
            ${info
              .map(
                (x) => `<th class="h ${x.cls}">${DAY_LABELS[dayKey(x.d)]}<small>${fmtShort(x.d)}</small>${
                  x.badge ? `<em>${esc(x.badge)}</em>` : ""
                }</th>`
              )
              .join("")}
            <th class="tot">Total</th>${editable ? "<th></th>" : ""}
          </tr></thead>
          <tbody>${rows.map(rowHtml).join("")}</tbody>
          <tfoot>
            <tr class="day-tot"><td colspan="2">Day total</td>${info.map((x) => `<td class="h" data-daytot="${x.d}"></td>`).join("")}<td class="tot" data-grand></td>${editable ? "<td></td>" : ""}</tr>
            <tr class="expected"><td colspan="2">Expected</td>${info.map((x) => `<td class="h">${x.expected ? round2(x.expected) : "—"}</td>`).join("")}<td class="tot">${round2(info.reduce((s, x) => s + x.expected, 0))}</td>${editable ? "<td></td>" : ""}</tr>
          </tfoot>
        </table>
      </div>
      ${
        editable
          ? `<div class="actions">
               <button class="btn ghost" id="add-row">+ Add row</button>
               <span class="spacer"></span>
               <button class="btn" id="save">Save draft</button>
               <button class="btn primary" id="submit">Submit week</button>
             </div>
             <p class="muted small">Future dates, holidays, off days and full-day leave are locked. Once submitted, the week is locked; ask an admin to unlock it if you need to fix something.</p>`
          : ""
      }
      ${!opts.mine && submitted ? `<div class="actions"><button class="btn" id="unlock">Unlock week for editing</button></div>` : ""}
      ${!opts.mine && !sheet ? `<p class="muted">No timesheet saved for this week.</p>` : ""}`;

    const tbody = $("tbody", el);

    function readRows() {
      if (!editable) return rows;
      return $$("tr", tbody).map((tr) => {
        const hours = {};
        $$("input[name=h]", tr).forEach((inp) => {
          const v = round2(num(inp.value));
          if (v > 0) hours[inp.dataset.d] = v;
        });
        const projectId = $("select[name=project]", tr).value;
        return { projectId, projectName: projectName(projectId) || "", note: $("input[name=note]", tr).value.trim(), hours };
      });
    }

    function recalc() {
      const cur = readRows();
      $$("tr", tbody).forEach((tr, i) => {
        const t = Object.values(cur[i]?.hours || {}).reduce((s, v) => s + v, 0);
        $("[data-rowtot]", tr).textContent = t ? round2(t) : "";
      });
      let grand = 0;
      for (const x of info) {
        const t = cur.reduce((s, r) => s + (r.hours[x.d] || 0), 0);
        grand += t;
        const cell = $(`[data-daytot="${x.d}"]`, el);
        cell.textContent = t ? round2(t) : "";
        cell.classList.toggle("over", t > 24);
        cell.classList.toggle("short", x.expected > 0 && x.d <= today && t < x.expected);
      }
      $("[data-grand]", el).textContent = grand ? round2(grand) : "";
    }
    recalc();

    $$("[data-nav]", el).forEach(
      (b) =>
        (b.onclick = () => {
          const n = Number(b.dataset.nav);
          week = n === 0 ? weekStartOf(todayStr()) : addDays(week, n);
          opts.onWeekChange?.(week);
          draw();
        })
    );

    if (editable) {
      tbody.addEventListener("input", recalc);
      tbody.addEventListener("change", recalc);
      tbody.addEventListener("click", (e) => {
        if (!e.target.closest("[data-del]")) return;
        const tr = e.target.closest("tr");
        if ($$("tr", tbody).length === 1) {
          $$("input", tr).forEach((i) => (i.value = ""));
          $("select", tr).value = "";
        } else tr.remove();
        recalc();
      });
      $("#add-row", el).onclick = () => {
        tbody.insertAdjacentHTML("beforeend", rowHtml({ projectId: "", note: "", hours: {} }, tbody.children.length));
      };

      const save = async (status) => {
        const cur = readRows().filter((r) => r.projectId || r.note || Object.keys(r.hours).length);
        if (cur.some((r) => Object.keys(r.hours).length && !r.projectId)) throw new Error("Choose a project for every row that has hours.");
        for (const x of info) {
          if (cur.reduce((s, r) => s + (r.hours[x.d] || 0), 0) > 24) throw new Error(`More than 24 hours on ${fmtDate(x.d)}.`);
        }
        const total = round2(cur.reduce((s, r) => s + Object.values(r.hours).reduce((a, b) => a + b, 0), 0));
        if (status === "submitted") {
          const missing = info.filter((x) => x.expected > 0 && x.d <= today && !cur.some((r) => r.hours[x.d]));
          const msg = missing.length
            ? `No hours on ${missing.map((x) => fmtShort(x.d)).join(", ")}. Submit anyway? You won't be able to edit this week afterwards.`
            : `Submit ${total} hours for this week? You won't be able to edit it afterwards.`;
          if (!(await confirmBox("Submit timesheet", msg, "Submit"))) return;
        }
        const data = {
          uid: opts.user.uid,
          username: opts.user.username,
          name: opts.user.name || opts.user.username,
          weekStart: week,
          status,
          entries: cur,
          totalHours: total,
          wfhDates: info.filter((x) => x.wfh && cur.some((r) => r.hours[x.d])).map((x) => x.d),
          updatedAt: serverTimestamp(),
        };
        if (status === "submitted") data.submittedAt = serverTimestamp();
        await setDoc(doc(db, "timesheets", `${opts.user.uid}_${week}`), data);
        toast(status === "submitted" ? "Timesheet submitted." : "Draft saved.");
        draw();
      };
      const saveBtn = $("#save", el);
      const subBtn = $("#submit", el);
      saveBtn.onclick = busy(saveBtn, () => save("draft"));
      subBtn.onclick = busy(subBtn, () => save("submitted"));
    }

    const unlock = $("#unlock", el);
    if (unlock)
      unlock.onclick = busy(unlock, async () => {
        if (!(await confirmBox("Unlock week", `Let ${opts.user.name || opts.user.username} edit this week again? They will need to submit it again.`, "Unlock"))) return;
        await setDoc(doc(db, "timesheets", `${opts.user.uid}_${week}`), { ...sheet, status: "draft", unlockedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        await audit(ctx.profile, "Unlocked timesheet", `${opts.user.username} · week of ${week}`);
        toast("Week unlocked.");
        draw();
      });
  }

  await draw();
}
