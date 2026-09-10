# The archive

This is where the schedule page's **time machine** keeps its history.

## Why it exists

ESPN publishes a projection for every future week and keeps **no record of what
it used to project**. Ask it in week 9 what it thought of week 13 back in week
2 and there is no endpoint and no archive — the number was overwritten when it
changed. So a reading of the forecast that is not captured while it is on
screen cannot be recovered afterwards, by any means.

The schedule page takes one reading a week automatically and keeps it in
browser storage. Browser storage is not durable: it goes when site data is
cleared, it is not on a phone, and it never existed in a private window. This
directory is where a reading stops depending on one browser on one machine.

## The convention

One file per league-season, named for both:

```
data/snapshots/<leagueId>-<season>.json
data/snapshots/476225250-2026.json
```

That is **exactly** what the page's **Export archive** button writes, so the
file needs no editing — download it and commit it under this name.

There is deliberately **no index file**. The page asks for that one path; it
either exists or it does not. An index would be one more thing that can
disagree with the directory beside it.

## What happens then

On loading a live league the page fetches that path once, silently, and imports
whatever it finds. A week the browser already holds is **kept**, not
overwritten — the copy recorded here at the time is closer to the truth than
one that has been round a file. A missing file is the normal case and is not an
error.

The practical effect is that the history restores itself: open the site in a
browser that has never seen the league and the committed readings come back
before anything is drawn.

## Why a person carries the file

A page cannot commit to a repository without a token, and a token in
client-side JavaScript is a public token — anyone reading the site could write
to the repo. So the export lands in a Downloads folder and is committed by
hand. That is one click every few weeks against a backend to run, and it buys
version history for nothing.

## What a file contains

The envelope `exportAll` writes, holding one entry per week:

```json
{
  "v": 1,
  "exportedAt": "2026-09-23T18:04:11.000Z",
  "leagueId": "476225250",
  "season": 2026,
  "snapshots": [ { "v": 1, "week": 1, "takenAt": "...", "teams": [...],
                   "games": [...], "proj": {...}, "strength": {...},
                   "sigma": 26.4 } ]
}
```

A few kilobytes a week. See the header of [`js/snapshots.js`](../../js/snapshots.js)
for why so little is kept, and what is deliberately left out.

`v` is the schema version. A file from a newer build is refused by name rather
than half-read.
