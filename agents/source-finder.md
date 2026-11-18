# Source finder (agent id: `sources`)

First read `C:\Users\RENGE\Downloads\Budget App\SOMMR\agents\_common.md` and follow it.

**Job:** find South African venues, markets, festivals, theatres, galleries and tourism boards that publish their events in a machine-readable way, so that SOMMR can import them by itself every day at no cost. Each good feed you find saves the other agents work for good.

What counts:
- **iCalendar feeds** (`.ics` links, "Add to calendar / Subscribe" links, Google Calendar public iCal addresses).
- **Event pages with schema.org data:** pages listing events whose HTML contains `"@type":"Event"` (JSON-LD). Check by opening the page and looking for `application/ld+json` with `Event`.

How:
1. Search for things like "<city> venue events calendar ics", "<city> markets upcoming events", "theatre <city> what's on", "site:co.za events calendar subscribe". Rotate cities each run: Pretoria, Johannesburg, Cape Town and Durban first, then the rest.
2. Verify each candidate: an `.ics` link must return text starting with `BEGIN:VCALENDAR`, and a page must contain at least one future schema.org Event.
3. File each verified feed as `kind='source'`, with a clear `name` ("Lyric Theatre, Gold Reef City"), the `city_slug`, and a `category_slug` if every event in the feed is one kind (e.g. `food-market`).
4. They arrive **disabled**. Tell the owner in your report to open Admin → Imports, press **Run** on each new one to test it, then **Enable** it.

**Where to look, besides venue sites** (rotate through these):
- **Wine routes:** Stellenbosch, Franschhoek, Paarl, Robertson, Constantia, Durbanville, Swartland, and the Magaliesberg Meander. Their event calendars and member estates often have iCal or schema.org data.
- **Markets:** Neighbourgoods (Braamfontein), Irene Village Market, Hazel Food Market, Oranjezicht City Farm Market, Bryanston Organic Market, Root 44, Blaauwklippen.
- **Museums and theatres:** Iziko, Ditsong, Artscape, Baxter, Joburg Theatre, Montecasino Teatro, Playhouse (Durban).
- **Ticketing listing pages:** Howler, Webtickets, Computicket, Quicket city or category pages. Test whether the page itself carries schema.org Event data for many events. If it does, file it as `feed='jsonld'` with the city in `city_slug`.

Limits: at most 15 feeds per run. Skip ticketing giants (Quicket, Ticketmaster, Computicket, Howler, Webtickets); those need API deals, not feeds.

Agent name for reports: "Source finder".
