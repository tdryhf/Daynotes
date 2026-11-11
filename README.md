# Daybook

Daybook turns the sample Excel habit tracker into an installable family app. It includes a daily check-in, progress charts, a habit calendar, focus timers, shared to-do lists, ideas, important dates, an encrypted private journal and photo gallery, backups, and offline use.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Without Supabase environment values, family records use browser storage and the encrypted journal is stored on the development machine in `.daybook/.system/cache/runtime/session/vault/daybook.vault.enc`.

## Connect Supabase

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor. It creates the shared records table and the encrypted journal envelope table with row-level security policies.
3. Copy `.env.example` to `.env.local`.
4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` using the project URL and public anon/publishable key from Supabase API settings.
5. Restart Vite or rebuild the app.

When configured, family records and the encrypted journal envelope sync through Supabase. The app intentionally has no sign-in: anyone with the app link can read and edit shared family records, and can read or replace the encrypted journal envelope. Journal contents and photos remain encrypted in the browser; use a strong passphrase and keep the recovery code safe. Never put a Supabase service-role key in a `VITE_` variable or in the browser app.

## Enable AI note refinement, goal coaching, and assistant

Set `GROQ_API_KEY` in `.env.local` for local use, or add it as a server environment variable in Vercel. It must not use a `VITE_` prefix: the key is read only by the local middleware or `/api/ai/*` serverless function. The app uses Groq's `openai/gpt-oss-120b` model to polish habit and task notes, coach users through a SMART goal draft, and answer questions or carry out supported Daybook actions. Goal drafts are reviewed in the app before saving. Goal coaching and assistant context include relevant goal, habit, and to-do records; note text is sent for note refinement. The public, passwordless app can be used by anyone with its link, so set provider spending limits and rotate any key that has been shared publicly.

The AI endpoint applies a best-effort per-IP request limit. Browser reminders use the Web Notifications API while Daybook is open; browser and operating-system scheduling policies may delay notifications when the app is suspended or closed.

## Where photos are stored

Photos added to the journal are resized and converted to JPEG in the browser, then encrypted together with journal text. With Supabase configured, the encrypted envelope (including the encrypted photo data) is stored in the `private_journal.envelope` Postgres row. It does not use a Supabase Storage bucket, and Supabase only receives ciphertext. Without Supabase configured, that ciphertext is saved in the local `.daybook` vault file on the computer running Vite. Photos are not saved into the phone's photo library.

This means each save uploads the journal envelope, including its photos. Keep the gallery modest; this app currently does not upload image objects separately to Supabase Storage.

## Deploy to Vercel

1. Push this project to a Git provider and import the repository in Vercel.
2. Keep the project root at the repository root. `vercel.json` sets the Vite build command, `dist` output, and client-side route fallback.
3. In Vercel **Project Settings → Environment Variables**, add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and server-only `GROQ_API_KEY` for Preview and Production (and Development if desired).
4. Deploy or redeploy after setting the variables. Vite embeds these public values during build, so changing them requires a new deployment.
5. Open the deployed URL over HTTPS, then check the Settings page for sync status and create or unlock the journal.

The Vercel deployment stores shared records and encrypted journal data in Supabase. It does not use Vercel's temporary local filesystem for user data. If this project already has a local `.daybook` journal, it is not copied automatically; unlock it locally and arrange an export/import migration before switching its storage backend.

## Install on a device

On the HTTPS site, use the browser's install option on desktop and Android. On iPhone or iPad, open the site in Safari, tap Share, then **Add to Home Screen**.

## Starter data, backups, and privacy

Starter habits are adapted from the supplied workbook. Sample check-ins, tasks, and an event are labeled in the app and can be cleared from **Settings**. Use **Settings → Download a backup** and **Import a backup** to export or merge shared family records. The encrypted private journal is stored separately and is not included in those backups. Avoid confidential information in the shared family daybook.
