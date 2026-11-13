import { db, collection, query, where, getDocs, orderBy, limit, listAll, loadProjects, INTERNAL_PROJECT } from "../fb.js";
import {
  $,
  esc,
  todayStr,
  weekStartOf,
  addDays,
  dayType,
  parseYmd,
  fmtDate,
  fmtShort,
  fmtTs,
  round2,
  downloadCsv,
  isLeave,
  overlaps,
  LEAVE_TYPES,
} from "../util.js";

let range = null;

export async function render(el, ctx) {
  const today = todayStr();
  range ||= { from: today.slice(0, 8) + "01", to: today };

  const thisWeek = weekStartOf(today);
  const lastWeek = addDays(thisWeek, -7);
  const qFrom = [weekStartOf(range.from), lastWeek].sort()[0];
  const qTo = [range.to, thisWeek].sort().at(-1);

  const [users, projects, requests, sheetSnap, auditSnap] = await Promise.all([
    listAll("users"),
    loadProjects(),
    listAll("requests"),
    getDocs(query(collection(db, "timesheets"), where("weekStart", ">=", qFrom), where("weekStart", "<=", qTo))),
    getDocs(query(collection(db, "audit"), orderBy("at", "desc"), limit(15))),
  ]);
  const sheets = sheetSnap.docs.map((d) => d.data());
  const people = users.filter((u) => u.active !== false && !u.deleted).sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username));
  const nameOf = (uid) => {
    const u = users.find((x) => x.id === uid);
    return u ? u.name || u.username : "Unknown";
  };
  const projName = (id, fallback) => (id === INTERNAL_PROJECT.id ? INTERNAL_PROJECT.name : projects.find((p) => p.id === id)?.name || fallback || "(removed project)");

  // Flatten hours inside the chosen range
  const lines = [];
  for (const s of sheets)
    for (const e of s.entries || [])
      for (const [date, h] of Object.entries(e.hours || {}))
        if (date >= range.from && date <= range.to && h > 0)
          lines.push({ date, uid: s.uid, projectId: e.projectId, project: projName(e.projectId, e.projectName), note: e.note, hours: h, wfh: (s.wfhDates || []).includes(date), status: s.status });

  const sum = (arr) => round2(arr.reduce((t, x) => t + x.hours, 0));
  const group = (arr, key) => arr.reduce((m, x) => (m.set(x[key], [...(m.get(x[key]) || []), x]), m), new Map());
  const byUser = group(lines, "uid");
  const byProject = group(lines, "project");
  const chips = (m) =>
    [...m.entries()]
      .map(([k, v]) => [k, sum(v)])
      .sort((a, b) => b[1] - a[1])
      .map(([k, h]) => `<span class="chip">${esc(k)} <b>${h}</b></span>`)
      .join("");

  // Today: where is everyone, and what are they on this week
  const todayType = dayType(today, ctx.cal);
  const approvedToday = requests.filter((r) => r.status === "approved" && r.from <= today && today <= r.to);
  const weekSheets = new Map(sheets.filter((s) => s.weekStart === thisWeek).map((s) => [s.uid, s]));
  const todayRows = people.map((u) => {
    const r = approvedToday.filter((x) => x.uid === u.id);
    const leave = r.find((x) => isLeave(x.type));
    const wfh = r.find((x) => x.type === "wfh");
    let where = todayType === "holiday" ? `Holiday — ${ctx.cal.holidays.get(today)}` : todayType === "off" ? "Off day" : "In office";
    let cls = todayType === "holiday" || todayType === "off" ? "none" : "ok";
    if (leave) (where = `${LEAVE_TYPES[leave.type]}${leave.half ? " (half day)" : ""}`), (cls = "bad");
    else if (wfh) (where = "Working from home"), (cls = "draft");
    const ws = weekSheets.get(u.id);
    const work = ws
      ? [...new Map((ws.entries || []).filter((e) => Object.keys(e.hours || {}).length).map((e) => [e.projectId + e.note, e])).values()]
          .map((e) => `<div><b>${esc(projName(e.projectId, e.projectName))}</b>${e.note ? ` — ${esc(e.note)}` : ""}</div>`)
          .join("")
      : "";
    return `<tr><td><strong>${esc(u.name || u.username)}</strong></td><td><span class="status ${cls}">${esc(where)}</span></td>
      <td class="small">${work || `<span class="muted">Nothing logged yet this week</span>`}</td></tr>`;
  });

  // Last week's timesheet compliance
  const [hh, mm] = (ctx.cal.dueTime || "11:00").split(":").map(Number);
  const due = parseYmd(thisWeek);
  due.setHours(hh, mm, 0, 0);
  const lastWeekSheets = new Map(sheets.filter((s) => s.weekStart === lastWeek).map((s) => [s.uid, s]));
  const compliance = people
    .filter((u) => !u.joiningDate || u.joiningDate <= addDays(lastWeek, 6))
    .map((u) => {
      const s = lastWeekSheets.get(u.id);
      if (!s || s.status !== "submitted") return { u, state: s ? "Draft, not submitted" : "Missing", cls: "bad" };
      const at = s.submittedAt?.toDate?.();
      return at && at > due ? { u, state: `Late — ${fmtTs(s.submittedAt)}`, cls: "draft" } : { u, state: "On time", cls: "ok" };
    })
    .filter((c) => c.cls !== "ok");

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  el.innerHTML = `
    <h1>Dashboard</h1>
    ${pendingCount ? `<a class="banner" href="#/admin/approvals">${pendingCount} leave/WFH request${pendingCount > 1 ? "s" : ""} waiting for approval →</a>` : ""}

    <section class="card">
      <h3>Today · ${fmtDate(today)}</h3>
      <div class="table-scroll"><table class="list"><thead><tr><th>Employee</th><th>Status</th><th>Working on this week</th></tr></thead>
      <tbody>${todayRows.join("")}</tbody></table></div>
    </section>

    <section class="card">
      <h3>Last week's timesheets (${fmtShort(lastWeek)} – ${fmtShort(addDays(lastWeek, 6))})</h3>
      ${
        compliance.length
          ? `<table class="list"><tbody>${compliance.map((c) => `<tr><td>${esc(c.u.name || c.u.username)}</td><td><span class="status ${c.cls}">${esc(c.state)}</span></td></tr>`).join("")}</tbody></table>`
          : `<p class="muted">Everyone submitted on time.</p>`
      }
    </section>

    <section class="card">
      <div class="toolbar">
        <h3>Hours</h3>
        <form id="range" class="inline-form">
          <input type="date" name="from" value="${range.from}" required> to <input type="date" name="to" value="${range.to}" required>
          <button class="btn small" type="submit">Apply</button>
        </form>
      </div>
      <p class="muted small">${fmtDate(range.from)} – ${fmtDate(range.to)} · ${sum(lines)} hours logged (drafts included)</p>
      <div class="grid two">
        <div><h4>By employee</h4>
          ${
            byUser.size
              ? `<table class="list"><tbody>${[...byUser.entries()]
                  .sort((a, b) => sum(b[1]) - sum(a[1]))
                  .map(([uid, v]) => `<tr><td><strong>${esc(nameOf(uid))}</strong><div class="chips">${chips(group(v, "project"))}</div></td><td class="num">${sum(v)} h</td></tr>`)
                  .join("")}</tbody></table>`
              : `<p class="muted">No hours in this range.</p>`
          }
        </div>
        <div><h4>By project</h4>
          ${
            byProject.size
              ? `<table class="list"><tbody>${[...byProject.entries()]
                  .sort((a, b) => sum(b[1]) - sum(a[1]))
                  .map(([p, v]) => {
                    const byU = new Map([...group(v, "uid").entries()].map(([k, x]) => [nameOf(k), x]));
                    return `<tr><td><strong>${esc(p)}</strong><div class="chips">${chips(byU)}</div></td><td class="num">${sum(v)} h</td></tr>`;
                  })
                  .join("")}</tbody></table>`
              : `<p class="muted">No hours in this range.</p>`
          }
        </div>
      </div>
      <div class="actions">
        <button class="btn" id="csv-time">Export timesheets (CSV)</button>
        <button class="btn" id="csv-leave">Export leave &amp; WFH (CSV)</button>
      </div>
    </section>

    <section class="card">
      <h3>Recent admin activity</h3>
      ${
        auditSnap.empty
          ? `<p class="muted">Nothing yet.</p>`
          : `<table class="list"><tbody>${auditSnap.docs
              .map((d) => d.data())
              .map((a) => `<tr><td class="small nowrap">${fmtTs(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td class="muted small">${esc(a.details)}</td></tr>`)
              .join("")}</tbody></table>`
      }
    </section>`;

  const form = $("#range", el);
  form.onsubmit = (e) => {
    e.preventDefault();
    if (form.to.value < form.from.value) return;
    range = { from: form.from.value, to: form.to.value };
    render(el, ctx);
  };

  $("#csv-time", el).onclick = () =>
    downloadCsv(`timesheets_${range.from}_to_${range.to}.csv`, [
      ["Date", "Employee", "Project", "Task / note", "Hours", "WFH", "Week status"],
      ...lines.sort((a, b) => a.date.localeCompare(b.date) || nameOf(a.uid).localeCompare(nameOf(b.uid))).map((l) => [l.date, nameOf(l.uid), l.project, l.note, l.hours, l.wfh ? "Yes" : "", l.status]),
    ]);

  $("#csv-leave", el).onclick = () =>
    downloadCsv(`leave_wfh_${range.from}_to_${range.to}.csv`, [
      ["Employee", "Type", "From", "To", "Half day", "Days", "Status", "Reason", "Decided by", "Comment"],
      ...requests
        .filter((r) => overlaps(r.from, r.to, range.from, range.to))
        .sort((a, b) => a.from.localeCompare(b.from))
        .map((r) => [r.name, LEAVE_TYPES[r.type], r.from, r.to, r.half ? "Yes" : "", r.days, r.status, r.reason, r.decidedBy || "", r.comment || ""]),
    ]);
}
