import { db, collection, addDoc, doc, updateDoc, serverTimestamp, listWhere } from "../fb.js";
import {
  $,
  $$,
  esc,
  toast,
  busy,
  confirmBox,
  todayStr,
  countRequestDays,
  leaveUsage,
  LEAVE_TYPES,
  isLeave,
  overlaps,
  fmtRange,
  fmtTs,
  round2,
  wfhLimit,
  wfhByWeek,
  daysByWeek,
  weekStartOf,
  fmtShort,
  addDays,
} from "../util.js";

export const statusPill = (s) => `<span class="status ${s === "approved" ? "ok" : s === "pending" ? "draft" : s === "rejected" ? "bad" : "none"}">${esc(s[0].toUpperCase() + s.slice(1))}</span>`;

export async function render(el, ctx) {
  const p = ctx.profile;
  const requests = (await listWhere("requests", "uid", "==", p.uid)).sort((a, b) => b.from.localeCompare(a.from));
  const year = new Date().getFullYear();
  const usage = leaveUsage(requests, year);
  const left = (t) => round2((p.quotas?.[t] ?? 0) - usage[t].used - usage[t].pending);
  const wfhMax = wfhLimit(p);
  const wfhWeeks = wfhByWeek(requests, ctx.cal);
  const thisWeek = weekStartOf(todayStr());
  const wfhThisWeek = round2(wfhWeeks.get(thisWeek) || 0);

  el.innerHTML = `
    <h1>Leave &amp; work from home</h1>
    <div class="stats">
      ${["casual", "sick", "earned"]
        .map(
          (t) => `<div class="stat"><span>${LEAVE_TYPES[t]}</span><strong>${left(t)}</strong>
            <small>left of ${p.quotas?.[t] ?? 0} · ${round2(usage[t].used)} used${usage[t].pending ? ` · ${round2(usage[t].pending)} pending` : ""}</small></div>`
        )
        .join("")}
      <div class="stat"><span>Work from home · this week</span><strong>${round2(Math.max(0, wfhMax - wfhThisWeek))}</strong>
        <small>left of ${wfhMax} per week · ${wfhThisWeek} used or pending · ${round2(usage.wfh.used)} approved in ${year}</small></div>
    </div>

    <div class="grid two">
      <section class="card">
        <h3>New request</h3>
        <form class="stack" novalidate>
          <label>Type<select name="type">${Object.entries(LEAVE_TYPES)
            .map(([k, v]) => `<option value="${k}">${v}</option>`)
            .join("")}</select></label>
          <div class="row2">
            <label>From<input type="date" name="from" required value="${todayStr()}"></label>
            <label>To<input type="date" name="to" required value="${todayStr()}"></label>
          </div>
          <label class="check"><input type="checkbox" name="half"> Half day (single date only)</label>
          <label>Reason<textarea name="reason" rows="3" maxlength="500" placeholder="Optional for WFH, helpful for leave"></textarea></label>
          <p class="days-note muted"></p>
          <p class="form-error" hidden></p>
          <button class="btn primary" type="submit">Send request</button>
        </form>
      </section>
      <section class="card">
        <h3>My requests</h3>
        ${
          requests.length
            ? `<div class="table-scroll"><table class="list">
                <thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th></th></tr></thead>
                <tbody>${requests
                  .map(
                    (r) => `<tr>
                      <td>${esc(LEAVE_TYPES[r.type])}</td>
                      <td>${fmtRange(r.from, r.to)}${r.half ? " (half)" : ""}${r.reason ? `<div class="muted small">${esc(r.reason)}</div>` : ""}</td>
                      <td>${r.days}</td>
                      <td>${statusPill(r.status)}${r.comment ? `<div class="muted small">“${esc(r.comment)}”</div>` : ""}${
                        r.decidedBy ? `<div class="muted small">by ${esc(r.decidedBy)}, ${fmtTs(r.decidedAt)}</div>` : ""
                      }</td>
                      <td>${r.status === "pending" ? `<button class="btn ghost small" data-cancel="${r.id}">Cancel</button>` : ""}</td>
                    </tr>`
                  )
                  .join("")}</tbody></table></div>`
            : `<p class="muted">No requests yet.</p>`
        }
      </section>
    </div>`;

  const form = $("form", el);
  const note = $(".days-note", form);
  const err = $(".form-error", form);

  const compute = () => {
    const f = form.from.value;
    const t = form.to.value;
    form.half.disabled = f !== t;
    if (f !== t) form.half.checked = false;
    const days = countRequestDays(f, t, form.half.checked, ctx.cal);
    note.textContent = f && t && t >= f ? `${days} working day${days === 1 ? "" : "s"} (holidays and off days are not counted)` : "";
    return days;
  };
  form.addEventListener("input", compute);
  form.addEventListener("change", compute);
  compute();

  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const type = form.type.value;
    const from = form.from.value;
    const to = form.to.value;
    const days = compute();
    const fail = (m) => ((err.textContent = m), (err.hidden = false));
    if (!from || !to) return fail("Choose the dates.");
    if (to < from) return fail("The end date is before the start date.");
    if (days <= 0) return fail("Those dates are all holidays or off days.");
    const clash = requests.find((r) => (r.status === "pending" || r.status === "approved") && overlaps(from, to, r.from, r.to));
    if (clash) return fail(`You already have a ${clash.status} request for ${fmtRange(clash.from, clash.to)}.`);
    if (type === "wfh") {
      for (const [w, d] of daysByWeek(from, to, form.half.checked, ctx.cal)) {
        const already = wfhWeeks.get(w) || 0;
        if (already + d > wfhMax)
          return fail(`You can work from home up to ${wfhMax} day(s) a week. The week of ${fmtShort(w)}–${fmtShort(addDays(w, 6))} already has ${round2(already)}.`);
      }
    }
    if (isLeave(type)) {
      if (from.slice(0, 4) !== to.slice(0, 4)) return fail("Please split leave that crosses into a new year into two requests.");
      const u = leaveUsage(requests, from.slice(0, 4))[type];
      const bal = round2((p.quotas?.[type] ?? 0) - u.used - u.pending);
      if (days > bal) return fail(`Not enough ${LEAVE_TYPES[type].toLowerCase()}: ${bal} day(s) left.`);
    }
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    try {
      await addDoc(collection(db, "requests"), {
        uid: p.uid,
        username: p.username,
        name: p.name || p.username,
        type,
        from,
        to,
        half: form.half.checked,
        days,
        reason: form.reason.value.trim(),
        status: "pending",
        createdAt: serverTimestamp(),
      });
      toast("Request sent to admins.");
      render(el, ctx);
    } catch (ex) {
      fail(ex.message);
      btn.disabled = false;
    }
  };

  $$("[data-cancel]", el).forEach((b) => {
    b.onclick = busy(b, async () => {
      if (!(await confirmBox("Cancel request", "Cancel this pending request?", "Cancel request", true))) return;
      await updateDoc(doc(db, "requests", b.dataset.cancel), { status: "cancelled", updatedAt: serverTimestamp() });
      toast("Request cancelled.");
      render(el, ctx);
    });
  });
}
