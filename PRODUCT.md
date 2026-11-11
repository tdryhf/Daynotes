# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: an installable, responsive web app (PWA) for phones, tablets, and desktop browsers, with a hosted shared database. Choose an implementation that can be hosted with a free or low-cost static app host and a hosted Postgres service.

## Users

One family shares a simple home base. Each person can check off daily habits across devices. A parent can add and organize family to-dos, idea lists, and important dates. Anyone who opens the shared app can view and edit it, without a password.

## Product Purpose

Turn the family's spreadsheet habit tracker into an easy shared app for daily habit check-ins, goals, time-bounded targets, family tasks, important dates, and short journal entries that are easy to revisit.

## Positioning

A family tracker that joins the month-at-a-glance habit grid with practical household planning and a lightweight shared memory log.

## Operating Context

The workbook is used as a monthly tracker with a selected month and year, habit rows, per-habit goal counts, weekly progress, completed/left totals, and a top-habits summary. The app should be quick to use on a phone and legible on a larger screen.

## Capabilities and Constraints

- The family workspace is open to anyone with its link; the personal journal is protected by a passphrase and encrypted before it reaches the locally hosted journal service.
- Family data is shared through a hosted cloud backend and should also remain usable offline, syncing changes when connectivity returns.
- Track habits by date, set monthly or weekly targets and time limits, and review progress.
- Set SMART goals with a measurable target and date range; link habit check-ins and completed to-dos so they contribute directly to goal progress.
- Open a tracker for date-bounded totals, completion percentage, remaining target, actual entry charts, missing log days, and deterministic progress analysis.
- Add family to-dos and categorized idea lists, important dates, and a private free-flow journal with page-by-page writing and a separate labeled photo gallery.
- The specific cloud provider, hosting account, and deployment destination were not supplied; prepare a working local setup and clear configuration/deployment instructions.
- Shared habits, tasks, dates, and ideas remain public and editable. Journal pages and gallery photos are encrypted in the browser before local-server storage.

## Evidence on Hand

- `Habit Tracker  (1).xlsx`: sample monthly tracker. Its visible content includes February 2026 settings, weekly progress, per-habit goals/completions, global progress, and sample habits such as waking at 6 AM, drinking 3L water, gym workouts, stretching, reading, meditation, and study.
- The workbook is sample data; its entries must be identified as examples and should not be represented as actual family records.
- No family name, logo, brand system, account credentials, hosting project, or database credentials were supplied.

## Product Principles

- Checking in should take one tap from the current day.
- Monthly progress should be readable without losing the detail of each date.
- Household planning and habit tracking should share one clear family workspace.
- The journal should help people find a memory later with minimal writing effort.
- State plainly that this workspace is public and editable when opened by anyone with its link.
