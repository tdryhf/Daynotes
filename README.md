# Daybook

Daybook turns the sample Excel habit tracker into an installable family app. It includes a daily check-in, progress charts, a habit calendar, focus timers, shared to-do lists, ideas, important dates, an encrypted private journal and photo gallery, backups, and offline use.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The app connects to the shared Daybook backend (the `daynotes` Supabase project, configured in [`src/config.ts`](src/config.ts)), so local runs read and write the same family data as the live site.

## Backend (Supabase)

[`supabase/schema.sql`](supabase/schema.sql) is the complete backend. Run it in the Supabase SQL Editor to set up a new project, then point the app at it with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (in `.env.local` or the hosting environment) or by editing `src/config.ts`. Only ever use the public anon/publishable key in the app — never a service-role key.

- **Family records** (habits, check-ins, to-dos, goals, trackers, ideas, dates, reminders) are readable by anyone with the app link, by design. Writes go through the `push_family_records` function, which keeps the most recently edited copy of each record, so an out-of-date device can't overwrite newer changes. Each device keeps a local copy, pulls changes every few seconds while open (and immediately when it regains focus or connection), and retries unsent edits until the cloud confirms them.
- **The private journal** is encrypted in the browser with a key that only the passphrase or the recovery code unlocks. The database stores ciphertext only. Changing or deleting it requires a write token derived from that key, so the public link alone can't overwrite it. Saves are version-checked: when two devices edit at once, the copies are merged, and if the same page was changed in both places the other version is kept on a new page rather than lost. Unsent journal edits are kept, encrypted, on the device and sent when it's back online.

## Enable AI note refinement, goal coaching, and assistant

Set `GROQ_API_KEY` in `.env.local` for local use, or add it as a server environment variable in Vercel. It must not use a `VITE_` prefix: the key is read only by the local middleware or `/api/ai/*` serverless function. The app uses Groq's `openai/gpt-oss-120b` model to polish habit and task notes, coach users through a SMART goal draft, and answer questions or carry out supported Daybook actions. Goal drafts are reviewed in the app before saving. Goal coaching and assistant context include relevant goal, habit, and to-do records; note text is sent for note refinement. The public, passwordless app can be used by anyone with its link, so set provider spending limits and rotate any key that has been shared publicly.

The AI endpoint applies a best-effort per-IP request limit. Browser reminders use the Web Notifications API while Daybook is open; browser and operating-system scheduling policies may delay notifications when the app is suspended or closed.

## Where photos are stored

Journal photos are resized and converted to JPEG in the browser (which also drops location metadata), encrypted with the journal key, and stored one per row in the `private_journal_photos` table. Each photo is uploaded once; journal saves only carry the text. Adding a photo needs a connection. Photos are not saved into the phone's photo library.

## Deploy to Vercel

The Vercel project deploys automatically from the `main` branch of the GitHub repository. `vercel.json` sets the Vite build command, the `dist` output, and the client-side route fallback. The Supabase connection is built in (see above), so no Vercel variables are needed for sync.

Supabase pauses free-plan projects after about a week without activity. To prevent that, `vercel.json` schedules a daily Vercel cron that calls `/api/keepalive` (`server/keepalive.ts`), which reads one row id with the public key. You can see each run under **Project → Settings → Cron Jobs** in Vercel. Optionally set a `CRON_SECRET` environment variable in Vercel so the endpoint answers only Vercel's own cron calls.

To enable the AI features, add `GROQ_API_KEY` under **Project Settings → Environment Variables** in Vercel (Production and Preview), then redeploy. Without it the `/api/ai/*` endpoints answer "AI is not configured" and the rest of the app works normally.

## Install on a device

On the HTTPS site, use the browser's install option on desktop and Android. On iPhone or iPad, open the site in Safari, tap Share, then **Add to Home Screen**.

## Starter data, backups, and privacy

Starter habits are adapted from the supplied workbook. Sample check-ins, tasks, and an event are labeled in the app and can be cleared from **Settings**. Use **Settings → Download a backup** and **Import a backup** to export or merge shared family records. The encrypted private journal is stored separately and is not included in those backups. Keep the journal recovery code somewhere safe: without the passphrase or that code, nobody — including the site owner — can open the journal. Avoid confidential information in the shared family daybook.
