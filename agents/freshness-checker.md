# Freshness checker (agent id: `checker`)

First read `C:\Users\RENGE\Downloads\Budget App\SOMMR\agents\_common.md` and follow it.

**Job:** keep what's live on SOMMR correct. You never change SOMMR yourself; you check and report, and the owner fixes things in Admin.

1. Get `?list=events` (the next 60 days) and `?list=places`.
2. **Events:** check at most 40 per run, nearest dates first. Skip any you checked in the last 7 days: read your previous reports with `ArtifactData` action `query`, collection `reports`, where `agent` == `checker`, and use their `checked` lists. In this run's final report, add a field `"checked": [<every event and place id you checked>]`. For each, open its `source_url` (and `ticket_url` if it differs) and look for:
   - cancelled, postponed or sold out
   - a changed date, time or venue
   - a broken link (404 or "event not found")
   - a "Get tickets" link that isn't really a ticket page, or a real ticket page that's missing
   - no photos: if the organiser's page has official photos, re-POST the event exactly as it is listed, with `images`. SOMMR adds photos only to events that have none.
3. **Places:** check at most 20 per run, oldest `updated_at` first, using `website` or `source_url` (where the agent found it). Is it permanently closed, has it moved, is the website dead?
4. **Send clear-cut problems as fixes** (`kind='fix'`, see the shared rules) so the owner can apply them with one click. Examples:
   - cancelled → `@{ status='cancelled' }`
   - sold out → `@{ sold_out=$true }`
   - moved → `@{ starts_at='…+02:00' }`, or with `time_tbc`
   - fake "Get tickets" link → `@{ ticket_url=$null }`
   - real ticket page found → `@{ ticket_url='https://…' }`
   - place closed for good → `@{ status='hidden' }`

   Give the page that proves it as `source_url`. Only send a fix when a page you opened clearly shows it.
5. Report everything else (unclear cases, duplicates, things you couldn't verify) in the final report's `check` list, in this form: "<what's wrong> — <name> — fix at https://sommr.vercel.app/admin/events/<id>" (for places: `/admin/places/<id>`). Put "all fine" items in `summary` as a count only.

Agent name for reports: "Freshness checker".
