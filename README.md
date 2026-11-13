# Ark Studio · Team Tracker

Timesheets, leave and work-from-home requests for The Ark Studio. It runs for ₹0 and needs no credit card:

| Piece | Service (free plan) | What it does |
|---|---|---|
| Website | GitHub Pages | Serves the app (`index.html`, `css/`, `js/`) |
| Logins + database | Firebase Spark (Authentication + Firestore) | Usernames/passwords, timesheets, leave, projects, holidays |
| Admin helper | Cloudflare Workers | Creates logins and lets admins reset passwords, deactivate and remove people |

Nothing needs to be installed on your computer. Every step happens in a web browser.

---

## 1. Firebase (about 10 minutes)

1. Go to <https://console.firebase.google.com>, click **Create a project**, name it `ark-tracker`. You can turn Google Analytics off. Stay on the free **Spark** plan.
2. **Add a web app.** On the project home page click the **</>** (Web) icon, name it `ark-tracker`, and skip Firebase Hosting. Firebase shows a `firebaseConfig` block. Copy `apiKey`, `authDomain`, `projectId` and `appId` into **`js/config.js`**.
3. **Turn on logins.** Go to **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save**. Usernames are stored as `username@arkstudio.local`. No emails are ever sent.
4. **Create the database.** Go to **Build → Firestore Database → Create database**. Choose a location such as `asia-south1 (Mumbai)` and **Start in production mode**.
5. **Add the security rules.** In Firestore, open the **Rules** tab, replace everything with the contents of **`firestore.rules`**, and click **Publish**.
6. **Get the admin key.** Open **⚙ Project settings → Service accounts → Generate new private key**. A `.json` file downloads. Treat it like a password: never upload it to GitHub and never share it. You'll paste it into Cloudflare in the next part.

## 2. Cloudflare Worker (about 5 minutes)

1. Sign up free at <https://dash.cloudflare.com>. No card is needed.
2. Go to **Workers & Pages → Create → Create Worker**, name it `ark-tracker-admin`, and click **Deploy**.
3. Click **Edit code**, delete the sample code, paste in all of **`worker/worker.js`**, and click **Deploy**.
4. Go to the worker's **Settings → Variables and Secrets** and add:

   | Name | Type | Value |
   |---|---|---|
   | `SERVICE_ACCOUNT_JSON` | Secret | The whole contents of the `.json` key from Firebase step 6 |
   | `FIREBASE_API_KEY` | Text | The same `apiKey` you put in `js/config.js` |
   | `ALLOWED_ORIGINS` | Text | `https://YOUR-GITHUB-USERNAME.github.io` (no path, no trailing slash) |
   | `BOOTSTRAP_SECRET` | Secret | Any long random phrase. You need it once for setup, then delete it. |

5. Copy the worker's URL (it looks like `https://ark-tracker-admin.<something>.workers.dev`) into `WORKER_URL` in **`js/config.js`**.

## 3. GitHub Pages (about 5 minutes)

1. Create a **public** repository called `ark-tracker` on GitHub. Pages is free for public repos. The code holds no secrets, because Firebase web keys are meant to be public and the rules protect the data.
2. Upload everything in this folder **except `seed.private.json`**. The `.gitignore` already excludes it.
3. Go to **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
4. After a minute the app is live at `https://YOUR-GITHUB-USERNAME.github.io/ark-tracker/`.

## 4. First-time setup (2 minutes)

1. Open `https://YOUR-GITHUB-USERNAME.github.io/ark-tracker/setup.html`.
2. Enter your `BOOTSTRAP_SECRET`, paste the full contents of **`seed.private.json`**, and click **Create accounts**. Every line should show a ✓.
3. Back in Cloudflare, **delete the `BOOTSTRAP_SECRET` variable**. Setup also refuses to run again once an admin exists.
4. Open the app and sign in. Employees are asked to choose their own password at their first sign-in.

## 5. Day-one admin checklist

- **Projects:** add the studio's live projects.
- **Holidays & working days:** add this year's holidays and set the Saturday rule (full, half, off, or specific Saturdays off).
- **Employees:** check each person's leave quotas (Casual / Sick / Earned). They default to 12 / 6 / 12.

---

## How it works

- **Roles:** admins see everything and manage people, projects and the calendar. Employees see only their own timesheets and requests, plus every active project.
- **Timesheets:** one sheet per person per week, in hours per project per day with a task note. Holidays, off days, full-day leave and future dates are locked. Submitting locks the week; an admin can unlock it from **Timesheets**.
- **Leave & WFH:** request types are Casual, Sick, Earned or WFH, with half-day support. Days are counted on working days only. Any admin's approval or rejection is final. Balances reset every calendar year.
- **Dashboard:** shows who is in the office, on WFH or on leave today, what each person is working on this week, missing or late timesheets from last week, hours by employee and by project for any date range, and CSV exports.
- **Removing someone** deletes their login but keeps their history for reports. **Deactivate** blocks sign-in without deleting anything.
- **Free-plan limits:** Firestore allows 50,000 reads and 20,000 writes a day, far more than a studio this size uses. Cloudflare Workers is free up to 100,000 requests a day.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Could not reach the admin service" | Check `WORKER_URL` in `js/config.js` |
| "Origin not allowed" | `ALLOWED_ORIGINS` on the worker must exactly match the site address, e.g. `https://rohitbali.github.io` |
| "You don't have permission" | Firestore rules weren't published. Repeat Firebase step 5. |
| Sign-in fails for everyone | Email/Password sign-in isn't enabled (Firebase step 3), or `js/config.js` has the wrong `apiKey` or `projectId` |

## Files

```
index.html          the app
setup.html          one-time account setup
css/styles.css      look and feel (Ark rose-copper and charcoal)
js/config.js        your Firebase + worker settings  ← edit this
js/app.js           sign-in, navigation
js/views/*.js       each screen
firestore.rules     database security rules          ← paste into Firebase
worker/worker.js    Cloudflare admin helper          ← paste into Cloudflare
seed.private.json   first accounts + passwords       ← NEVER upload
```
