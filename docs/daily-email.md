# Morning email

The 5:00 Asia/Dubai check sends one email to **pedrocerdeira81@gmail.com**. The subject is exactly:

```
PT Planner daily sync
```

It is sent from Pedro’s own Gmail by the script, so it lands in his inbox. The assistant reads that inbox. There is no public JSON link. A link the assistant could open with curl would have to be open to anyone who has it, and that would expose client names. The planner itself stays on “Only myself”.

Google starts the job within about 15 minutes of 5:00, not always at 5:00:00. One email is sent per day from the automatic check. Tapping **Email today’s summary** in the gear sends another copy on purpose.

## When it worked

```
PT Planner daily sync
Status: ok
When: 2026-11-02 05:07 Asia/Dubai
Period: 2026-10-29 to 2026-11-29

Sessions added: 1
- Sara | 2026-11-02 07:00 | normal

Clients low or out: 1
- Jeremy | 2 left | low

Flagged notes: 2
- Jeremy | 2026-11-02 09:00 | free | Free pra compensar outras sessoes
- Mohammad family | 2026-11-02 18:00 | charged | Charged, give back friday

```

- The first line is always `PT Planner daily sync`.
- The second line is `Status: ok` or `Status: failed`.
- `When:` is Dubai time.
- `Period:` is the gym pay period that contains that morning, for example `2026-09-30 to 2026-10-28`. It is not a calendar month. The line is omitted if he has not saved a period yet.
- `Sessions added` lists kept sessions saved today or yesterday whose appointment is yesterday or later. Only titles that end in PT are sessions. A title that contains the word free, such as `Omar free PT`, is left out of that count. A long first import of older sessions is one line, `Older sessions saved: N`, and those names are not listed.
- An empty section is `- None`.
- A line is `Name | date time | normal|free|charged | note`.
- Low means 1 or 2 sessions left. Out means 0 or fewer. Free sessions do not use up a package. Normal and charged do.
- Flagged notes are free, charged, or a calendar note such as Charged, free, or “Nao tem sessoes”, for today and the next 7 days. Events that do not end in PT are not listed.
- Lists stop after 30 lines and then say `and N more`.

## When it failed

```
PT Planner daily sync
Status: failed
When: 2026-11-02 05:07 Asia/Dubai

The automatic check did not finish.
Error: …
Open PT Planner on the iPhone and tap Update from Calendar.
```
