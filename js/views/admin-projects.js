import { db, doc, collection, addDoc, updateDoc, serverTimestamp, loadProjects, audit } from "../fb.js";
import { $, $$, esc, toast, busy, modal } from "../util.js";

const fields = (p = {}) => `
  <label>Project name<input name="name" required maxlength="80" value="${esc(p.name || "")}"></label>
  <div class="row2">
    <label>Code<input name="code" maxlength="20" value="${esc(p.code || "")}" placeholder="e.g. GA-2BHK"></label>
    <label>Client<input name="client" maxlength="80" value="${esc(p.client || "")}"></label>
  </div>`;

export async function render(el, ctx) {
  const projects = await loadProjects();
  const active = projects.filter((p) => p.status !== "archived");
  const archived = projects.filter((p) => p.status === "archived");

  const table = (list) =>
    list.length
      ? `<div class="table-scroll"><table class="list">
          <thead><tr><th>Project</th><th>Code</th><th>Client</th><th></th></tr></thead>
          <tbody>${list
            .map(
              (p) => `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.code || "")}</td><td>${esc(p.client || "")}</td>
              <td class="nowrap"><button class="btn ghost small" data-edit="${p.id}">Edit</button>
              <button class="btn ghost small" data-arch="${p.id}">${p.status === "archived" ? "Restore" : "Archive"}</button></td></tr>`
            )
            .join("")}</tbody></table></div>`
      : `<p class="muted">None.</p>`;

  el.innerHTML = `
    <h1>Projects</h1>
    <div class="toolbar"><button class="btn primary" id="add">+ Add project</button></div>
    <section class="card"><h3>Active (${active.length})</h3>${table(active)}
      <p class="muted small">Every employee can log time to active projects, plus the built-in “Internal / Admin” bucket.</p></section>
    <section class="card"><h3>Archived (${archived.length})</h3>${table(archived)}</section>`;

  const refresh = () => render(el, ctx);
  const read = (v) => ({ name: v.name.trim(), code: v.code.trim(), client: v.client.trim() });
  const dupe = (name, id) => projects.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase());

  const add = $("#add", el);
  add.onclick = busy(add, async () => {
    const v = await modal({ title: "Add project", body: fields(), okText: "Add" });
    if (!v) return;
    const d = read(v);
    if (dupe(d.name)) throw new Error("A project with that name already exists.");
    await addDoc(collection(db, "projects"), { ...d, status: "active", createdAt: serverTimestamp() });
    await audit(ctx.profile, "Added project", d.name);
    toast("Project added.");
    refresh();
  });

  $$("[data-edit]", el).forEach((b) => {
    b.onclick = busy(b, async () => {
      const p = projects.find((x) => x.id === b.dataset.edit);
      const v = await modal({ title: "Edit project", body: fields(p) });
      if (!v) return;
      const d = read(v);
      if (dupe(d.name, p.id)) throw new Error("A project with that name already exists.");
      await updateDoc(doc(db, "projects", p.id), { ...d, updatedAt: serverTimestamp() });
      await audit(ctx.profile, "Edited project", d.name);
      toast("Saved.");
      refresh();
    });
  });

  $$("[data-arch]", el).forEach((b) => {
    b.onclick = busy(b, async () => {
      const p = projects.find((x) => x.id === b.dataset.arch);
      const status = p.status === "archived" ? "active" : "archived";
      await updateDoc(doc(db, "projects", p.id), { status, updatedAt: serverTimestamp() });
      await audit(ctx.profile, status === "archived" ? "Archived project" : "Restored project", p.name);
      toast(status === "archived" ? "Archived." : "Restored.");
      refresh();
    });
  });
}
