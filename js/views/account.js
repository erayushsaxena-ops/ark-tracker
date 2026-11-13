import {
  auth,
  db,
  doc,
  updateDoc,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  serverTimestamp,
} from "../fb.js";
import { $, esc, toast, friendlyError, passwordProblem, LEAVE_TYPES, fmtDate, wfhLimit } from "../util.js";

export async function render(el, ctx) {
  const p = ctx.profile;
  el.innerHTML = `
    <h1>Account</h1>
    <div class="grid two">
      <section class="card">
        <h3>Profile</h3>
        <dl class="kv">
          <dt>Name</dt><dd>${esc(p.name || "—")}</dd>
          <dt>Username</dt><dd>${esc(p.username)}</dd>
          <dt>Role</dt><dd>${p.role === "admin" ? "Admin" : "Employee"}</dd>
          <dt>Designation</dt><dd>${esc(p.designation || "—")}</dd>
          <dt>Joined</dt><dd>${p.joiningDate ? fmtDate(p.joiningDate) : "—"}</dd>
          <dt>Leave quota</dt><dd>${["casual", "sick", "earned"]
            .map((t) => `${LEAVE_TYPES[t].replace(" leave", "")}: ${p.quotas?.[t] ?? 0}`)
            .join(" · ")}</dd>
          <dt>Work from home</dt><dd>Up to ${wfhLimit(p)} day(s) a week</dd>
        </dl>
        <p class="muted small">To change these details, ask an admin.</p>
      </section>
      <section class="card">
        <h3>Change password</h3>
        <div id="pw"></div>
      </section>
    </div>`;
  renderPasswordForm($("#pw", el), ctx, () => {});
}

/** Shared change-password form (also used for the forced first-login change) */
export function renderPasswordForm(el, ctx, onDone) {
  el.innerHTML = `
    <form novalidate class="stack">
      <label>Current password<input type="password" name="current" autocomplete="current-password" required></label>
      <label>New password<input type="password" name="next" autocomplete="new-password" required></label>
      <label>Confirm new password<input type="password" name="confirm" autocomplete="new-password" required></label>
      <p class="muted small">At least 8 characters, with an uppercase letter, a lowercase letter and a number.</p>
      <p class="form-error" hidden></p>
      <button class="btn primary" type="submit">Update password</button>
    </form>`;
  const form = $("form", el);
  const err = $(".form-error", form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const { current, next, confirm } = Object.fromEntries(new FormData(form));
    const problem =
      (!current && "Enter your current password.") ||
      passwordProblem(next) ||
      (next !== confirm && "The new passwords don't match.") ||
      (next === current && "Choose a password different from the current one.");
    if (problem) {
      err.textContent = problem;
      err.hidden = false;
      return;
    }
    const btn = $("button", form);
    btn.disabled = true;
    try {
      const user = auth.currentUser;
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
      await updatePassword(user, next);
      if (ctx.profile.mustChangePassword)
        await updateDoc(doc(db, "users", user.uid), { mustChangePassword: false, passwordChangedAt: serverTimestamp() });
      form.reset();
      toast("Password updated.");
      onDone();
    } catch (ex) {
      err.textContent = String(ex.code || "").includes("invalid-credential") ? "Current password is wrong." : friendlyError(ex);
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  };
}
