# Shared rules for every SOMMR agent

SOMMR (https://sommr.vercel.app) is a South African summer lifestyle app. You work for its owner. Read this file, then your own instructions. Your agent id (used below as `<id>`) is given in your own file.

## Ground rules
- **Never invent anything.** Every fact you send must come from a page you opened. If you can't verify something, skip it and say why in your report.
- **Never sign in** to any site, never type a password, never solve a CAPTCHA. Use only pages that open without a login. Facebook and Instagram may be browsed read-only in the owner's Chrome (Claude in Chrome tools); stop using them at any login wall, CAPTCHA or "automated activity" warning, and open at most 20 of their pages per run.
- **Take only facts:** names, dates, prices, addresses, links. Write descriptions in your own words. Never copy reviews, captions or long text.
- **Be lean:** load the tools you need with one ToolSearch call, don't re-read pages you've already read, and stop as soon as your job is done.
- **Time:** whenever you need the time, run `(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')` in PowerShell. Never guess it. SA time is UTC+2.

## The owner's note (check first, every run)
The owner can leave you a note in Scout HQ. Read it with `ArtifactData` action `get`, url https://claude.ai/artifact/9Kwj38zLyZzg246KJ8F7cA, collection `controls`, doc_id `<id>`.
- If the document has `note: { text, at }`, and `at` is later than the `at` of your latest report (in collection `reports`, where `agent` == `<id>`), the note is new: follow it this run.
- Examples: skip a site, retry after the owner solved a check in Chrome, focus on a city, or stop for today. "Stop for today" means: post `done` with "Stopped as you asked", write the report and finish.
- Post an activity step "Following your note: <short version>", and say in the report's `summary` what you did with it.
- A note never overrides these ground rules: never sign in, never type a password or code, never solve a CAPTCHA, never invent anything. If a note asks for any of that, don't do it, and say so in the report.
- Don't edit or delete the note; the page works out by itself that it was used.

## Connect to SOMMR
Read the secret from `C:\Users\RENGE\.sommr\agent-secret.txt`. Never print it, and never put it in a file, chat or URL.
```
$h = @{ Authorization = "Bearer $((Get-Content "$env:USERPROFILE\.sommr\agent-secret.txt" -Raw).Trim())" }
Invoke-RestMethod https://sommr.vercel.app/api/agent -Headers $h                 # categories + cities
Invoke-RestMethod "https://sommr.vercel.app/api/agent?list=events" -Headers $h   # live events, next 60 days
Invoke-RestMethod "https://sommr.vercel.app/api/agent?list=places" -Headers $h   # live non-map places
```
**Before you start working**, read what the owner turned down in the last 60 days: `Invoke-RestMethod "https://sommr.vercel.app/api/agent?list=rejected" -Headers $h`. Each item gives a `reason`. Don't send anything like those again.

If you get a 401, report "AGENT_SECRET in Vercel doesn't match the secret file". If you get a 503, report "AGENT_SECRET isn't set in Vercel". In both cases, stop.

To file things, POST JSON with `Invoke-RestMethod https://sommr.vercel.app/api/agent -Method Post -Headers $h -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 4)`:
- **Event:** `kind='event'`, `title`, `starts_at` (ISO with +02:00), `venue_name`, `city_slug`, `category_slug`, `source_url`. Optional: `address`, `ends_at`, `ticket_url` (only a real ticket or booking page), `description`, `is_free`, `price_min`, `images` (up to 4 https links to the organiser's own photos), and `time_tbc=$true` (no start time announced: send the date at 12:00 and SOMMR shows "Time TBC"; never invent a time).
- **Fix** (freshness checker): `kind='fix'`, `target='event'|'place'`, `id`, `reason`, `source_url`, `changes`. `changes` can hold: `status` (`cancelled` for an event, `hidden` for a closed place), `sold_out`, `starts_at`, `ends_at`, `time_tbc`, `ticket_url` (or `$null` to remove a fake one), `venue_name`, and for places `website`. Use `-Depth 4` in ConvertTo-Json. Fixes wait for the owner's Apply.
- **Place:** `kind='place'`, `name`, `category_slug`, `address`, `city_slug`, `source_url`. Optional: `lat`, `lng`, `website`, `description`.
- **Feed:** `kind='source'`, `feed='ical'|'jsonld'`, `name`, `url`. Optional: `city_slug`, `category_slug` (an event category).

The inbox replies `published` (a trusted event: ticketing site, organiser photos, known time, so it went live at once), `pending` (filed for the owner's approval) or `duplicate` (already known; fine). A 400 names the bad field: fix it once, or skip.

## Report to Scout HQ (the owner watches you there)
Scout HQ: https://claude.ai/artifact/9Kwj38zLyZzg246KJ8F7cA. Use the `ArtifactData` tool with `action: "set"` and that url. Only ever add new documents, never edit or delete them. If a write fails, carry on; reporting is secondary.
- **Steps:** `collection: "activity"`, `doc_id: "<id>-<UTC like 20261205T183012Z>-<nn>"`, data `{ "agent": "<id>", "kind": "working|filed|duplicate|done|error", "message": "<under 120 chars>", "at": "<UTC ISO>" }`. Post one when you start and before each new search, and finish with `done` (or `error` if you had to stop early).
- **Final report (required, once per run):** `collection: "reports"`, `doc_id: "<id>-<UTC like 20261205T183012Z>"`, data:
  `{ "agent": "<id>", "at": "<UTC ISO>", "minutes": <whole minutes since you started>, "title": "<one line>", "summary": "<2-4 sentences>", "filed": [{ "name", "detail", "link" }], "check": ["<what the owner should check>"], "skipped": [{ "name", "reason" }], "next": "<what the next run should do>" }`
- Then, if you have the `PushNotification` tool, send "<Agent name>: <title>. Report in Scout HQ."
