import { listAll } from "../fb.js";
import { $, esc, weekStartOf, todayStr } from "../util.js";
import { renderSheet } from "./timesheet.js";

let selectedUid = null;
let selectedWeek = null;

export async function render(el, ctx) {
  const users = (await listAll("users"))
    .filter((u) => !u.deleted)
    .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username));
  if (!selectedUid || !users.some((u) => u.id === selectedUid)) selectedUid = users[0]?.id;
  selectedWeek ||= weekStartOf(todayStr());

  el.innerHTML = `
    <h1>Timesheets</h1>
    <div class="toolbar">
      <label class="inline">Employee
        <select id="who">${users
          .map((u) => `<option value="${u.id}" ${u.id === selectedUid ? "selected" : ""}>${esc(u.name || u.username)}${u.active === false ? " (inactive)" : ""}</option>`)
          .join("")}</select>
      </label>
    </div>
    <section class="card" id="sheet"></section>`;

  const draw = () => {
    const user = users.find((u) => u.id === selectedUid);
    if (!user) return;
    renderSheet($("#sheet", el), ctx, {
      user: { uid: user.id, ...user },
      mine: false,
      week: selectedWeek,
      onWeekChange: (w) => (selectedWeek = w),
    });
  };
  $("#who", el).onchange = (e) => {
    selectedUid = e.target.value;
    draw();
  };
  draw();
}
