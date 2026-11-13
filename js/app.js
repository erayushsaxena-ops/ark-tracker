import {
  auth,
  db,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  usernameToEmail,
  doc,
  getDoc,
  loadCalendar,
} from "./fb.js";
import { STUDIO_NAME } from "./config.js";
import { $, esc, friendlyError } from "./util.js";
import { renderPasswordForm } from "./views/account.js";

const ROUTES = {
  "/timesheet": { label: "My timesheet", load: () => import("./views/timesheet.js") },
  "/leave": { label: "Leave & WFH", load: () => import("./views/leave.js") },
  "/account": { label: "Account", load: () => import("./views/account.js") },
  "/admin/dashboard": { label: "Dashboard", admin: true, load: () => import("./views/admin-dashboard.js") },
  "/admin/approvals": { label: "Approvals", admin: true, load: () => import("./views/admin-approvals.js") },
  "/admin/timesheets": { label: "Timesheets", admin: true, load: () => import("./views/admin-timesheets.js") },
  "/admin/employees": { label: "Employees", admin: true, load: () => import("./views/admin-employees.js") },
  "/admin/projects": { label: "Projects", admin: true, load: () => import("./views/admin-projects.js") },
  "/admin/calendar": { label: "Holidays & working days", admin: true, load: () => import("./views/admin-calendar.js") },
};

const root = document.getElementById("app");
const ctx = { profile: null, cal: null, isAdmin: false };
ctx.reloadCalendar = async () => (ctx.cal = await loadCalendar());

let loginMessage = "";

onAuthStateChanged(auth, async (user) => {
  if (!user) return renderLogin();
  root.innerHTML = `<div class="loading">Loading…</div>`;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || snap.data().active === false) {
      loginMessage = "Your account is not active. Please contact an admin.";
      await signOut(auth);
      return;
    }
    ctx.profile = { uid: user.uid, ...snap.data() };
    ctx.isAdmin = ctx.profile.role === "admin";
    await ctx.reloadCalendar();
    if (ctx.profile.mustChangePassword) return renderForcedPassword();
    renderShell();
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="center-card"><h2>Couldn't load your account</h2><p>${esc(friendlyError(err))}</p>
      <button class="btn" id="out">Sign out</button></div>`;
    $("#out").onclick = () => signOut(auth);
  }
});

function brand(kind = "full") {
  if (kind === "bar")
    return `<div class="brand bar"><img src="logo-mark-light.png" alt="${esc(STUDIO_NAME)}"><span>Team tracker</span></div>`;
  return `<div class="brand full"><img src="logo-full.png" alt="${esc(STUDIO_NAME)} — Architecture, Interior, Vaastu"><small>Team tracker</small></div>`;
}

function renderLogin() {
  ctx.profile = null;
  root.innerHTML = `
    <div class="login-wrap">
      <form class="center-card login" novalidate>
        ${brand()}
        <h2>Sign in</h2>
        <label>Username<input name="username" autocomplete="username" required autocapitalize="none" spellcheck="false"></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-error" ${loginMessage ? "" : "hidden"}>${esc(loginMessage)}</p>
        <button class="btn primary block" type="submit">Sign in</button>
        <p class="muted small">Forgot your password? Ask an admin to reset it.</p>
      </form>
    </div>`;
  loginMessage = "";
  const form = $("form", root);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = $(".form-error", form);
    const btn = $("button", form);
    err.hidden = true;
    const username = form.username.value.trim();
    if (!username || !form.password.value) {
      err.textContent = "Enter your username and password.";
      err.hidden = false;
      return;
    }
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      await signInWithEmailAndPassword(auth, usernameToEmail(username), form.password.value);
    } catch (ex) {
      err.textContent = friendlyError(ex);
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  };
}

function renderForcedPassword() {
  root.innerHTML = `<div class="login-wrap"><div class="center-card">${brand()}
    <h2>Set a new password</h2>
    <p class="muted">Welcome, ${esc(ctx.profile.name || ctx.profile.username)}. Please choose your own password before continuing.</p>
    <div id="pw"></div>
    <button class="btn ghost block" id="out">Sign out</button></div></div>`;
  $("#out").onclick = () => signOut(auth);
  renderPasswordForm($("#pw"), ctx, () => {
    ctx.profile.mustChangePassword = false;
    renderShell();
  });
}

function navLinks() {
  const mine = ["/timesheet", "/leave", "/account"];
  const admin = Object.keys(ROUTES).filter((r) => ROUTES[r].admin);
  const link = (r) => `<a href="#${r}" data-route="${r}">${esc(ROUTES[r].label)}</a>`;
  return `
    <div class="nav-group">${mine.map(link).join("")}</div>
    ${ctx.isAdmin ? `<div class="nav-label">Admin</div><div class="nav-group">${admin.map(link).join("")}</div>` : ""}`;
}

function renderShell() {
  root.innerHTML = `
    <header class="topbar">
      <button class="menu-btn" aria-label="Menu">☰</button>
      ${brand("bar")}
      <div class="who"><span>${esc(ctx.profile.name || ctx.profile.username)}</span>
        ${ctx.isAdmin ? `<span class="pill">Admin</span>` : ""}
        <button class="btn ghost small" id="signout">Sign out</button></div>
    </header>
    <div class="layout">
      <nav class="sidebar">${navLinks()}</nav>
      <main id="view"></main>
    </div>`;
  $("#signout").onclick = () => signOut(auth);
  $(".menu-btn").onclick = () => document.body.classList.toggle("nav-open");
  $(".sidebar").onclick = (e) => e.target.closest("a") && document.body.classList.remove("nav-open");
  window.onhashchange = route;
  route();
}

async function route() {
  if (!ctx.profile) return;
  let path = location.hash.replace(/^#/, "") || (ctx.isAdmin ? "/admin/dashboard" : "/timesheet");
  if (!ROUTES[path] || (ROUTES[path].admin && !ctx.isAdmin)) path = "/timesheet";
  document.querySelectorAll(".sidebar a").forEach((a) => a.classList.toggle("active", a.dataset.route === path));
  const view = $("#view");
  view.innerHTML = `<div class="loading">Loading…</div>`;
  try {
    const mod = await ROUTES[path].load();
    await mod.render(view, ctx);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card"><h3>Something went wrong</h3><p>${esc(friendlyError(err))}</p></div>`;
  }
}
