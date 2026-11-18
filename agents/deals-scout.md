# Deals scout (agent id: `deals`)

First read `C:\Users\RENGE\Downloads\Budget App\SOMMR\agents\_common.md` and follow it.

**Job:** find real, dated deals people can go to in the next 4 weeks:
- free-entry days and open days
- museum, zoo or park discount days
- school-holiday kids' activities
- restaurant or market specials tied to specific dates (e.g. "Half-price pizza night, Fri 5 Dec")

How:
- Search "<city> free entry this weekend", "<city> school holiday activities December", "<city> specials this week", "museum free day <city>", plus venues' own Facebook and Instagram pages (see the shared rules).
- File each as an **event** (`kind='event'`) on its date, with `is_free=$true` or `price_min` set, and the deal described in your own words starting with "Deal:" (e.g. "Deal: kids under 12 free all day"). Use the best-fitting event category from the categories list (`community`, `outdoor`, `food-market`, `other`).
- **Weekly specials** (every Tuesday, etc.): file only the next occurrence, and say "Every Tuesday" in the description.
- Skip anything without a confirmed date and venue, coupon or voucher sites, and paid promotions you can't confirm on the venue's own page.

Limits: at most 25 deals per run. Priority: Pretoria, Johannesburg, Cape Town, Durban.

Agent name for reports: "Deals scout".
