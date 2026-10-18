# WorldPulse 🌍

**One planet. Billions of feelings.**

WorldPulse is an anonymous, global mood map. Visitors pick how they feel and the country they want to be counted in, then explore the emotional pulse of the world on an interactive 3D globe with live, privacy-preserving statistics.

- **Frontend:** semantic HTML, CSS and vanilla JavaScript modules. No build step needed to develop.
- **Globe:** Three.js, NASA Blue Marble imagery (via `three-globe`), and Natural Earth country borders (via `world-atlas`).
- **Charts:** Chart.js.
- **Backend:** Supabase (Postgres, Row Level Security, RPC functions, Realtime broadcast).
- **Hosting:** any static host. Vercel config is included.

Every library loads from jsDelivr at a pinned version. You don't need a paid API.

---

## Contents

1. [Project structure](#project-structure)
2. [Run locally (demo mode)](#run-locally-demo-mode)
3. [Connect Supabase](#connect-supabase)
4. [Deploy to GitHub and Vercel](#deploy-to-github-and-vercel)
5. [How it works](#how-it-works)
6. [Privacy and security model](#privacy-and-security-model)
7. [Moderation](#moderation)
8. [Data retention](#data-retention)
9. [Testing](#testing)
10. [Maintaining and extending](#maintaining-and-extending)

---

## Project structure

```
index.html                 Single-page app markup (hero + globe, pulse, insights, feed, about, dialogs)
css/styles.css             Design tokens, glassmorphism UI, responsive layout, reduced-motion rules
js/
  app.js                   App controller: state, rendering, share flow, search, realtime/polling
  globe.js                 Three.js globe: textures, atmosphere, borders overlay, markers, picking, camera
  geo.js                   Tiny TopoJSON decoder + point-in-polygon country hit-testing + SVG fallback paths
  charts.js                Chart.js distribution/timeline charts + accessible data tables
  data.js                  Data sources: SupabaseSource (live) and DemoSource (labelled sample data)
  countries.js             ISO 3166-1 dataset (alpha-2, numeric, name, approx. centre) + flag emoji
  moods.js                 Mood categories, colours, time windows
  libs.js                  Pinned CDN URLs and a lazy script loader
  config.js                Public runtime config (empty = demo mode); generated at build time
assets/favicon.svg
supabase/
  schema.sql               Tables, RLS, indexes, validation, rate limits, moderation, aggregates, realtime, retention
  seed_countries.sql       Valid country codes (generated from js/countries.js)
  tests.sql                Database tests (privileges, validation, rate limits, thresholds, moderation, retention)
scripts/
  dev-server.mjs           Local server using the same security headers as vercel.json
  build.mjs                Copies the site to dist/ and writes dist/js/config.js from env vars
  config.mjs               Env → config, refuses service-role keys
  generate-country-sql.mjs Regenerates supabase/seed_countries.sql
tests/e2e.mjs              Playwright end-to-end tests (demo mode, mocked live mode, mobile, no-WebGL)
vercel.json                Build settings + security headers (CSP, nosniff, frame-ancestors, permissions)
.env.example               Environment variables
```

---

## Run locally (demo mode)

You need Node.js 18 or newer.

```bash
git clone <your-fork-url> worldpulse
cd worldpulse
npm run dev           # http://localhost:5173
```

If Supabase isn't configured, the app runs in **demo mode**:

- A banner at the top says "Demo mode", and the hero status reads "Demo data · sample only, not live".
- Statistics come from about 4,200 sample records generated in your browser. Every country uses the same base mood distribution, so the demo never suggests that nationality predicts emotion.
- Your submissions are stored only in `localStorage` and marked "You · this browser" in the feed. The success screen says clearly that nothing was saved to a database.
- Demo data never mixes with real data. Live mode never shows sample data.

You can force demo mode on a configured deployment with `?demo=1`.

---

## Connect Supabase

### 1. Create a project

1. Sign in at [supabase.com](https://supabase.com) and create a project. The free tier is enough.
2. Wait for the database to finish provisioning.

### 2. Create the schema

1. Open **SQL Editor → New query**.
2. Paste all of `supabase/schema.sql` and click **Run**.
3. Open a new query, paste `supabase/seed_countries.sql` and click **Run**.

Both scripts are idempotent. Re-run `schema.sql` whenever you pull changes to it.

### 3. Turn on scheduled retention (recommended)

1. Go to **Database → Extensions** and enable **pg_cron**.
2. Run `supabase/schema.sql` again. It detects pg_cron and schedules `private.purge_old_data()` daily at 03:17 UTC.

If you skip this step, run `select private.purge_old_data();` yourself on a regular schedule.

### 4. Check Realtime

The schema broadcasts a **content-free** `pulse` event on the public topic `worldpulse-pulse` with `realtime.send()` (Supabase's Broadcast-from-Database feature). When a client receives the event, it re-fetches the aggregates. No row data is ever broadcast, and clients never subscribe to tables.

- No configuration is needed on current Supabase projects.
- If Realtime isn't available, the trigger swallows the error so inserts still succeed. The UI falls back to polling and shows "Updated HH:MM · refreshing every 60s".

### 5. Get your public keys

Go to **Project Settings → API** and copy:

- **Project URL**, for example `https://abcd1234.supabase.co`
- **anon / publishable key**

> ⚠️ **Never** use the `service_role` / secret key in the frontend. The build script checks for a service-role key and refuses to publish one.

### 6. Configure locally

```bash
cp .env.example .env
# edit .env:
# WORLDPULSE_SUPABASE_URL=https://abcd1234.supabase.co
# WORLDPULSE_SUPABASE_ANON_KEY=eyJ...   (anon key)
npm run dev
```

The dev server builds `js/config.js` from `.env` on the fly. Alternatively, put the URL and anon key directly in `js/config.js` and commit it (the anon key is public by design); environment variables, when set, override the file at build time. The hero status should change to **Live** within a few seconds.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `WORLDPULSE_SUPABASE_URL` | for live mode | Supabase Project URL |
| `WORLDPULSE_SUPABASE_ANON_KEY` | for live mode | Supabase anon / publishable key (public) |
| `WORLDPULSE_POLL_INTERVAL_MS` | no | Polling interval when Realtime is unavailable (default 60000, minimum 15000) |
| `WORLDPULSE_CONTACT_EMAIL` | no | Shown in the Contact dialog |
| `WORLDPULSE_GITHUB_URL` | no | Footer GitHub link and the demo banner's setup link |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` also work as fallbacks.

---

## Deploy to GitHub and Vercel

### GitHub

```bash
git init && git add . && git commit -m "WorldPulse"
git branch -M main
git remote add origin https://github.com/<you>/worldpulse.git
git push -u origin main
```

`.env` is git-ignored. Don't commit real keys. The anon key is public by design, but keep it in environment variables anyway.

### Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the GitHub repository.
2. Leave **Framework Preset** on "Other". `vercel.json` already sets:
   - Build Command: `node scripts/build.mjs`
   - Output Directory: `dist`
3. Under **Settings → Environment Variables**, add `WORLDPULSE_SUPABASE_URL` and `WORLDPULSE_SUPABASE_ANON_KEY`, plus any optional variables, for Production and Preview.
4. Deploy. Pushes to `main` redeploy automatically.

**Custom Supabase domain:** if you use one, add it to `connect-src` (both `https://` and `wss://`) in the CSP in `vercel.json`.

**Other hosts** (Netlify, Cloudflare Pages, GitHub Pages): run `npm run build` and serve `dist/`. Copy the headers from `vercel.json` into your host's header configuration.

---

## How it works

### Globe

- Three.js renders a textured Earth with a bump map on desktop. Phones and slow connections get a lighter texture. The scene also has a fresnel atmosphere, a star field and soft lighting.
- Country borders, the mood tint, hover and selection are drawn onto a transparent canvas texture wrapped over the Earth.
- **Real country boundaries are clickable.** A ray cast gives a latitude/longitude, which is tested against Natural Earth 1:110m polygons. Small states missing from that dataset (Singapore, Malta and others) are picked by the nearest country centre within 2.5°, and they can always be found through search.
- Markers show **aggregates only**, placed at an approximate country centre and never at anyone's location. A marker's colour is the country's most shared mood, and its size grows with the number of moods. Countries below the privacy threshold appear as faint dots with no numbers.
- Controls: drag or touch to rotate, scroll or pinch to zoom, pause/resume, reset view, and a country search combobox.
- Rendering pauses when the globe is off-screen or the tab is hidden. Reduced-motion users get no auto-rotation, no pulsing and instant camera moves.
- **Fallbacks:** without WebGL, a clickable flat SVG map is shown. If the boundary data also fails, a plain country list is shown.

### Live pulse and insights

- Time windows: 1 hour, 24 hours, 7 days and 30 days. Every number comes from `get_global_stats`, `get_country_markers` and `get_country_stats`.
- The trend compares positive share and per-mood share with the previous period of the same length. It only appears when both periods have at least 10 moods.
- Country insights show the flag, name, total, top mood, a country-vs-world chart, a timeline, the previous period and the last-updated time. These are hidden below 10 moods in the selected window.
- Every chart has a text label (emoji, name and percentage), an `aria-label` summary and a "View as table" equivalent.

### Share flow

The flow is three steps, and takes about 10 seconds with a mouse:

1. **Mood.** Clicking a mood moves on automatically. Keyboard users press Continue.
2. **Country.** Search by name, pick from the dropdown, or choose on the globe. The app never requests or detects your location.
3. **Optional note.** "Mood only" is the default. Notes are limited to 140 characters, and the form explains that they are public after moderation.

The submit button, **Add My Pulse to the World**, checks the input on the client and calls `submit_mood`, which validates everything again on the server. A success animation follows, then the aggregates refresh.

---

## Privacy and security model

| Concern | Implementation |
| --- | --- |
| Raw data never public | Tables live in the `private` schema, which the Data API doesn't expose. RLS is enabled with **no** policies. Privileges are revoked from `anon` and `authenticated`. |
| Controlled writes | The only write path is `public.submit_mood()`, a `SECURITY DEFINER` function with `search_path = ''` and fully qualified names. |
| Server-side validation | Mood must exist in `private.moods`. Country must exist in `private.countries` (ISO alpha-2). Timestamps come from `now()`, stored as `timestamptz` in UTC. The client token format is checked. |
| Rate limiting | Per browser: 1 per 60 s and 12 per day. Per network: 60 per hour. Notes: 5 per day. Reports: 20 per day. Concurrent requests from the same browser are serialised with an advisory lock. |
| What's hashed | The rate-limit ledger stores `sha256(value + secret salt + UTC date)` of the random browser token and of the request IP. Raw IPs are never stored. The hashes rotate daily, aren't linked to moods, and are deleted after 48 h. |
| Bot protection | A honeypot field (bots get a fake success and nothing is stored), the rate limits above, and the moderation queue. For stronger protection, see [Extending](#maintaining-and-extending). |
| Content moderation | Control and zero-width characters are stripped and whitespace is collapsed. Notes are rejected for links, emails, @handles, phone-like numbers, markup, repeated-character spam or blocked terms. **Rejected text is discarded.** Accepted notes are `pending` until approved (or auto-approved if you opt in). |
| Reporting | `report_message()` takes one report per browser per message. A note is hidden automatically after 3 reports, or straight away for "personal information". |
| Small-group protection | Country breakdowns, marker counts and moods are suppressed below `min_country_group` (default 10) moods in the window. |
| Messages kept separate | Notes live in `private.mood_messages`. Aggregates never read them, and they have a shorter retention. |
| Public feed | `get_recent_activity()` returns only mood, country, minute-precision time and an approved note. It never returns IDs of submissions, tokens or hashes. |
| XSS | All user content is inserted with `textContent`. The CSP allows scripts only from `'self'` and jsDelivr, with no inline scripts. |
| Errors | RPC errors show a generic message. Database details are logged to the console only, not shown in the UI. |
| Keys | Only the anon key ships to browsers. `scripts/config.mjs` refuses service-role / `sb_secret_` keys. |

**Hosting metadata:** Vercel, Supabase, jsDelivr and Google Fonts receive standard request metadata (IP address, user agent) in their own logs. The in-app Privacy dialog says so. Review and adapt that text for your jurisdiction before launch.

---

## Moderation

Run these in the Supabase SQL editor:

```sql
-- Review the queue (pending notes and reported/hidden notes)
select * from private.moderation_queue;

-- Approve, reject or hide a note
select private.moderate_message('<message-uuid>', 'approved');
select private.moderate_message('<message-uuid>', 'rejected');

-- Publish notes that pass the automatic filters without manual review (not recommended at launch)
update private.settings set value = 'true' where key = 'auto_approve_messages';

-- Add a blocked term (lower case)
insert into private.blocked_terms values ('example-term');
```

Other settings in `private.settings`:

- `min_country_group`: privacy threshold
- `retention_days`
- `message_retention_days`
- `auto_hide_reports`

---

## Data retention

| Data | Kept for |
| --- | --- |
| Moods (`private.mood_submissions`) | 90 days (`retention_days`) |
| Notes and their reports | 30 days (`message_retention_days`) |
| Rate-limit hashes | 48 hours |

`private.purge_old_data()` enforces these limits. pg_cron runs it daily once enabled.

---

## Testing

### Database (privileges, validation, abuse prevention, thresholds)

Use a **non-production** database. The tests run inside a transaction and roll back at the end.

```bash
DATABASE_URL="postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres" npm run test:db
```

The tests cover:

- `anon` cannot read or insert raw rows or call private functions
- invalid mood, country, window and token are rejected
- the honeypot works
- rapid duplicates are rate limited
- links, phone numbers, markup and over-long notes are rejected and not stored
- pending notes are hidden
- the feed exposes only the documented fields
- reports hide a note after 3
- countries below the threshold are suppressed
- marker and global maths are correct
- the per-network limit works
- the retention purge works

The suite also runs against a plain local Postgres (14+). Create the `anon` and `authenticated` roles and a stub `realtime.send()` first.

### End-to-end (UI, responsiveness, accessibility basics)

```bash
npm install
npx playwright install chromium
npm run test:e2e        # screenshots are saved to test-results/
```

The tests cover:

- demo labelling
- globe or fallback rendering
- country search, the country card and insights
- privacy suppression in the UI
- window and mood filters
- the full share flow in under 15 s
- the client-side duplicate block
- keyboard-only mood selection and Escape
- no horizontal scroll at 375 px, plus the mobile menu
- the no-WebGL fallback
- live mode against a mocked Supabase: honest empty state, XSS escaping, the exact submission payload, and an unreachable database showing an error rather than demo data

### Manual checklist before launch

- [ ] In live mode the demo banner is absent and the status reads **Live**.
- [ ] Submitting twice within a minute is blocked (UI message from the server).
- [ ] `curl "$URL/rest/v1/mood_submissions" -H "apikey: $ANON"` returns an error. The table isn't exposed.
- [ ] A note with a link is rejected. A clean note appears only after `moderate_message(..., 'approved')`.
- [ ] A country with fewer than 10 moods shows "Fewer than 10" everywhere.
- [ ] Lighthouse: Accessibility ≥ 95. Check with a screen reader and keyboard only.
- [ ] Test on a low-end Android phone. Check the result with "prefers-reduced-motion" turned on.
- [ ] Check the response headers on the deployed site: CSP, `X-Frame-Options`, `Permissions-Policy`.

---

## Maintaining and extending

- **Add a mood:** add it to `private.moods` in `schema.sql` and to `js/moods.js`, using the same code.
- **Change countries:** edit `js/countries.js`, run `npm run countries:sql`, then run `seed_countries.sql`.
- **Stronger bot protection:** add [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/). Verify the token in a Supabase Edge Function that calls `submit_mood` with the service role, then revoke `submit_mood` from `anon`.
- **Translations:** UI strings are in `index.html` and `js/app.js`. Mood labels are in `js/moods.js`.
- **Higher-resolution borders:** swap `countries-110m.json` for `countries-50m.json` in `js/libs.js`. It's larger, so keep 110m on mobile.
- **Scaling:** aggregates are computed on the fly with indexes on `created_at`, `(country_code, created_at)` and `(mood, created_at)`. At very high volume, add an hourly rollup table filled by pg_cron and point the aggregate functions at it.

### Disclaimer

WorldPulse shows voluntary self-reports. It isn't a scientific measurement of any nation's mental health, and a country's results never describe how any individual from that country feels.

## License

MIT
