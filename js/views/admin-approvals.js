import { db, doc, updateDoc, serverTimestamp, listAll, audit } from "../fb.js";
import { $$, esc, toast, busy, modal, leaveUsage, LEAVE_TYPES, isLeave, fmtRange, fmtTs, round2, wfhLimit, wfhByWeek, daysByWeek, fmtShort } from "../util.js";
import { statusPill } from "./leave.js";

export async function render(el, ctx) {
  const [requests, users] = await Promise.all([listAll("requests"), listAll("users")]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const pending = requests.filter((r) => r.status === "pending").sort((a, b) => a.from.localeCompare(b.from));
  const decided = requests
    .filter((r) => r.status === "approved" || r.status === "rejected")
    .sort((a, b) => (b.decidedAt?.seconds || 0) - (a.decidedAt?.seconds || 0))
    .slice(0, 50);

  const balance = (r) => {
    if (r.type === "wfh") {
      const u = userById.get(r.uid);
      const max = wfhLimit(u);
      const others = wfhByWeek(requests.filter((x) => x.uid === r.uid && x.status === "approved"), ctx.cal, r.id);
      const notes = [...daysByWeek(r.from, r.to, r.half, ctx.cal)].map(([w, d]) => {
        const total = round2((others.get(w) || 0) + d);
        return `${total} of ${max} WFH in week of ${fmtShort(w)}${total > max ? ` <b class="warn">· over limit</b>` : ""}`;
      });
      return notes.length ? `<div class="muted small">${notes.join("<br>")}</div>` : "";
    }
    if (!isLeave(r.type)) return "";
    const u = userById.get(r.uid);
    const use = leaveUsage(
      requests.filter((x) => x.uid === r.uid && x.id !== r.id),
      r.from.slice(0, 4)
    )[r.type];
    const left = round2((u?.quotas?.[r.type] ?? 0) - use.used);
    return `<div class="muted small">${left} ${LEAVE_TYPES[r.type].toLowerCase()} left before this${left < r.days ? ` <b class="warn">· exceeds balance</b>` : ""}</div>`;
  };

  el.innerHTML = `
    <h1>Approvals</h1>
    <section class="card">
      <h3>Pending (${pending.length})</h3>
      ${
        pending.length
          ? `<div class="table-scroll"><table class="list">
              <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th></th></tr></thead>
              <tbody>${pending
                .map(
                  (r) => `<tr>
                    <td><strong>${esc(r.name)}</strong><div class="muted small">sent ${fmtTs(r.createdAt)}</div></td>
                    <td>${esc(LEAVE_TYPES[r.type])}${balance(r)}</td>
                    <td>${fmtRange(r.from, r.to)}${r.half ? " (half)" : ""}</td>
                    <td>${r.days}</td>
                    <td>${esc(r.reason || "—")}</td>
                    <td class="nowrap">
                      <button class="btn primary small" data-act="approved" data-id="${r.id}">Approve</button>
                      <button class="btn ghost small" data-act="rejected" data-id="${r.id}">Reject</button>
                    </td></tr>`
                )
                .join("")}</tbody></table></div>`
          : `<p class="muted">Nothing waiting for approval.</p>`
      }
    </section>
    <section class="card">
      <h3>Recent decisions</h3>
      ${
        decided.length
          ? `<div class="table-scroll"><table class="list">
              <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Decided</th></tr></thead>
              <tbody>${decided
                .map(
                  (r) => `<tr><td>${esc(r.name)}</td><td>${esc(LEAVE_TYPES[r.type])}</td><td>${fmtRange(r.from, r.to)}</td><td>${r.days}</td>
                  <td>${statusPill(r.status)}${r.comment ? `<div class="muted small">“${esc(r.comment)}”</div>` : ""}</td>
                  <td class="small">${esc(r.decidedBy || "")}<div class="muted">${fmtTs(r.decidedAt)}</div></td></tr>`
                )
                .join("")}</tbody></table></div>`
          : `<p class="muted">No decisions yet.</p>`
      }
    </section>`;

  $$("[data-act]", el).forEach((b) => {
    b.onclick = busy(b, async () => {
      const r = pending.find((x) => x.id === b.dataset.id);
      const approve = b.dataset.act === "approved";
      const v = await modal({
        title: `${approve ? "Approve" : "Reject"} ${LEAVE_TYPES[r.type].toLowerCase()}`,
        body: `<p>${esc(r.name)} · ${fmtRange(r.from, r.to)} · ${r.days} day(s)</p>
               <label>Comment (optional)<textarea name="comment" rows="3" maxlength="300"></textarea></label>`,
        okText: approve ? "Approve" : "Reject",
        danger: !approve,
      });
      if (!v) return;
      await updateDoc(doc(db, "requests", r.id), {
        status: b.dataset.act,
        comment: v.comment.trim(),
        decidedBy: ctx.profile.name || ctx.profile.username,
        decidedByUid: ctx.profile.uid,
        decidedAt: serverTimestamp(),
      });
      await audit(ctx.profile, approve ? "Approved request" : "Rejected request", `${r.username} · ${r.type} · ${r.from}→${r.to}`);
      toast(approve ? "Approved." : "Rejected.");
      render(el, ctx);
    });
  });
}
