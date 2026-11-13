import { db, doc, setDoc, updateDoc, serverTimestamp, listAll, callWorker, audit } from "../fb.js";
import { DEFAULT_EMPLOYEE_PASSWORD } from "../config.js";
import { $, $$, esc, toast, busy, modal, confirmBox, passwordProblem, fmtDate, todayStr, num } from "../util.js";

let showRemoved = false;

const profileFields = (u = {}) => `
  <div class="row2">
    <label>Full name<input name="name" required value="${esc(u.name || "")}"></label>
    <label>Designation<input name="designation" value="${esc(u.designation || "")}" placeholder="e.g. Junior Designer"></label>
  </div>
  <div class="row2">
    <label>Joining date<input type="date" name="joiningDate" value="${esc(u.joiningDate || "")}"></label>
    <label>Role<select name="role">
      <option value="employee" ${u.role !== "admin" ? "selected" : ""}>Employee</option>
      <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
    </select></label>
  </div>
  <fieldset><legend>Leave quota per year (days)</legend>
    <div class="row3">
      <label>Casual<input type="number" name="casual" min="0" step="0.5" value="${u.quotas?.casual ?? 12}"></label>
      <label>Sick<input type="number" name="sick" min="0" step="0.5" value="${u.quotas?.sick ?? 6}"></label>
      <label>Earned<input type="number" name="earned" min="0" step="0.5" value="${u.quotas?.earned ?? 12}"></label>
    </div>
  </fieldset>`;

const quotasFrom = (v) => ({ casual: num(v.casual), sick: num(v.sick), earned: num(v.earned) });

export async function render(el, ctx) {
  const users = (await listAll("users")).sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username));
  const activeAdmins = users.filter((u) => u.role === "admin" && u.active !== false && !u.deleted);
  const shown = users.filter((u) => showRemoved || !u.deleted);

  el.innerHTML = `
    <h1>Employees</h1>
    <div class="toolbar">
      <button class="btn primary" id="add">+ Add employee</button>
      <label class="check"><input type="checkbox" id="removed" ${showRemoved ? "checked" : ""}> Show removed</label>
    </div>
    <section class="card">
      <div class="table-scroll"><table class="list">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Designation</th><th>Joined</th><th>Leave quota (C/S/E)</th><th>Status</th><th></th></tr></thead>
        <tbody>${shown
          .map(
            (u) => `<tr class="${u.active === false ? "dim" : ""}">
              <td><strong>${esc(u.name || "—")}</strong></td>
              <td>${esc(u.username)}</td>
              <td>${u.role === "admin" ? `<span class="pill">Admin</span>` : "Employee"}</td>
              <td>${esc(u.designation || "")}</td>
              <td>${u.joiningDate ? fmtDate(u.joiningDate) : ""}</td>
              <td>${u.quotas?.casual ?? 0} / ${u.quotas?.sick ?? 0} / ${u.quotas?.earned ?? 0}</td>
              <td>${u.deleted ? "Removed" : u.active === false ? "Inactive" : u.mustChangePassword ? "Active · must set password" : "Active"}</td>
              <td class="nowrap">${
                u.deleted
                  ? ""
                  : `<button class="btn ghost small" data-edit="${u.id}">Edit</button>
                     <button class="btn ghost small" data-pw="${u.id}">Reset password</button>
                     ${u.id === ctx.profile.uid ? "" : `<button class="btn ghost small" data-toggle="${u.id}">${u.active === false ? "Activate" : "Deactivate"}</button>
                     <button class="btn ghost small danger-text" data-del="${u.id}">Remove</button>`}`
              }</td></tr>`
          )
          .join("")}</tbody>
      </table></div>
      <p class="muted small">Removing someone deletes their login but keeps their timesheets and leave history for reports.</p>
    </section>`;

  const byId = (id) => users.find((u) => u.id === id);
  const isLastAdmin = (u) => u.role === "admin" && activeAdmins.length <= 1;
  const refresh = () => render(el, ctx);

  $("#removed", el).onchange = (e) => {
    showRemoved = e.target.checked;
    refresh();
  };

  const addBtn = $("#add", el);
  addBtn.onclick = busy(addBtn, async () => {
    const v = await modal({
      title: "Add employee",
      okText: "Create login",
      body: `
        <div class="row2">
          <label>Username<input name="username" required pattern="[A-Za-z0-9._\\-]{3,40}" placeholder="e.g. akash.nishad" autocapitalize="none" spellcheck="false"></label>
          <label>Initial password<input name="password" required value="${esc(DEFAULT_EMPLOYEE_PASSWORD)}"></label>
        </div>
        ${profileFields({ joiningDate: todayStr() })}
        <p class="muted small">They'll be asked to choose their own password at first sign-in. Usernames are not case-sensitive.</p>`,
    });
    if (!v) return;
    const username = v.username.trim();
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw new Error("That username already exists.");
    const prob = passwordProblem(v.password);
    if (prob) throw new Error(prob);
    const { uid } = await callWorker("/createUser", { username, password: v.password, displayName: v.name.trim() });
    await setDoc(doc(db, "users", uid), {
      username,
      name: v.name.trim(),
      designation: v.designation.trim(),
      joiningDate: v.joiningDate,
      role: v.role,
      quotas: quotasFrom(v),
      active: true,
      mustChangePassword: true,
      createdAt: serverTimestamp(),
    });
    await audit(ctx.profile, "Added user", `${username} (${v.role})`);
    toast(`${v.name} added. Username: ${username}`);
    refresh();
  });

  $$("[data-edit]", el).forEach((b) => {
    b.onclick = busy(b, async () => {
      const u = byId(b.dataset.edit);
      const v = await modal({ title: `Edit ${u.username}`, body: profileFields(u) });
      if (!v) return;
      if (u.role === "admin" && v.role !== "admin" && isLastAdmin(u)) throw new Error("You can't remove the last admin.");
      if (u.id === ctx.profile.uid && v.role !== "admin" && !(await confirmBox("Remove your own admin access?", "You will lose access to admin pages.", "Continue", true))) return;
      await updateDoc(doc(db, "users", u.id), {
        name: v.name.trim(),
        designation: v.designation.trim(),
        joiningDate: v.joiningDate,
        role: v.role,
        quotas: quotasFrom(v),
        updatedAt: serverTimestamp(),
      });
      await audit(ctx.profile, "Edited user", u.username);
      toast("Saved.");
      if (u.id === ctx.profile.uid) location.reload();
      else refresh();
    });
  });

  $$("[data-pw]", el).forEach((b) => {
    b.onclick = busy(b, async () => {
      const u = byId(b.dataset.pw);
      const v = await modal({
        title: `Reset password — ${u.username}`,
        okText: "Set password",
        body: `<label>New password<input name="password" required value="${esc(DEFAULT_EMPLOYEE_PASSWORD)}"></label>
               <label class="check"><input type="checkbox" name="force" checked> Ask them to choose a new password at next sign-in</label>
               <p class="muted small">At least 8 characters, with uppercase, lowercase and a number. Share it with them directly.</p>`,
      });
      if (!v) return;
      const prob = passwordProblem(v.password);
      if (prob) throw new Error(prob);
      await callWorker("/setPassword", { uid: u.id, password: v.password });
      await updateDoc(doc(db, "users", u.id), { mustChangePassword: !!v.force, updatedAt: serverTimestamp() });
      await audit(ctx.profile, "Reset password", u.username);
      toast(`Password updated for ${u.username}.`);
      refresh();
    });
  });

  $$("[data-toggle]", el).forEach((b) => {
    b.onclick = busy(b, async () => {
      const u = byId(b.dataset.toggle);
      const deactivate = u.active !== false;
      if (deactivate && isLastAdmin(u)) throw new Error("You can't deactivate the last admin.");
      if (deactivate && !(await confirmBox("Deactivate", `${u.name || u.username} won't be able to sign in until reactivated.`, "Deactivate", true))) return;
      await callWorker("/setDisabled", { uid: u.id, disabled: deactivate });
      await updateDoc(doc(db, "users", u.id), { active: !deactivate, updatedAt: serverTimestamp() });
      await audit(ctx.profile, deactivate ? "Deactivated user" : "Activated user", u.username);
      toast(deactivate ? "Deactivated." : "Activated.");
      refresh();
    });
  });

  $$("[data-del]", el).forEach((b) => {
    b.onclick = busy(b, async () => {
      const u = byId(b.dataset.del);
      if (isLastAdmin(u)) throw new Error("You can't remove the last admin.");
      if (!(await confirmBox("Remove employee", `Remove ${u.name || u.username}? Their login is deleted; past timesheets and leave stay in reports.`, "Remove", true))) return;
      await callWorker("/deleteUser", { uid: u.id });
      await updateDoc(doc(db, "users", u.id), { active: false, deleted: true, removedAt: serverTimestamp() });
      await audit(ctx.profile, "Removed user", u.username);
      toast("Removed.");
      refresh();
    });
  });
}
