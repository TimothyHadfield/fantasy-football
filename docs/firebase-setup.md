# Connecting the site to Firebase

This is the click-by-click for the one part of the phone bridge that nobody
else can do for you. Everything in it happens in Google's console, signed in as
you, and no tool on this project can reach it.

**What it buys you.** Your league is private, so the site can only read it
through the bridge extension, and no phone can install an extension. That is
why the site drops to demo data on your iPhone. Once this is done, the desktop
publishes the league every time you open the site there, and the phone reads
what the desktop published. Not live — as fresh as the last time you opened it
on the computer, which is what you asked for.

**How long it honestly takes.** About **fifteen minutes**, in **two sittings**.
The second sitting exists because one of the values you need — your own user id
— does not exist until you have signed in once, and you cannot sign in until
the first sitting is finished. The gap between them can be five minutes or five
days.

**What it costs.** Nothing. The free tier is 50,000 document reads and 20,000
writes a day. A full cold load of every page on this site costs 28 reads and a
sync costs 28 writes, so you could open the whole site sixty times a day and
still be nowhere near it. You do not need to enter a card.

---

## Sitting one — about twelve minutes

### 1. Create the project

Open [console.firebase.google.com](https://console.firebase.google.com/) and
sign in with the Google account you want to own this.

1. Click **Create a Firebase project** (it says **Add project** if you already
   have others).
2. Name it `fantasy-football`. Google will append some characters to make the
   id unique — `fantasy-football-a1b2c` or similar. **That full id is your
   project id.** Write it down; you need it twice below.
3. When it offers **Enable Google Analytics for this project**, turn it
   **off**. Nothing here uses it and it adds a consent step you do not need.
4. Click **Create project**, then **Continue** when it finishes.

### 2. Create the database

Go to [the Firestore page](https://console.firebase.google.com/project/_/firestore).
(If that link lands on the wrong project, pick this one from the project
switcher at the top left. In the left-hand menu it is under
**Databases & Storage → Firestore**.)

1. Click **Create database**.
2. **Choose a location.** Pick the one physically nearest you —
   `europe-west2 (London)` if you are in the UK, `us-central1 (Iowa)` if you
   are not. **This cannot be changed afterwards**; the only fix is deleting the
   database and starting again. It only affects how quickly the phone loads.
3. For the starting mode, choose **Start in production mode**. The description
   under it reads *"Denies all reads and writes from mobile and web clients"* —
   that is correct and deliberate. Test mode leaves your league readable by
   anyone on the internet for thirty days. You will paste proper rules in step
   6 and finish them in sitting two.
4. Click **Create**.

### 3. Turn on Google sign-in

Go to [the sign-in providers page](https://console.firebase.google.com/project/_/authentication/providers).
(In the left-hand menu: **Security → Authentication**. If you land on a splash
screen, click **Get started** first.)

1. On the **Sign-in method** tab, click **Google** in the provider list.
2. Turn on the **Enable** toggle.
3. **Public-facing name for project** — leave whatever it suggests.
4. **Support email for project** — choose your own address from the dropdown.
   It is required and it will not be shown to anyone but you.
5. Click **Save**.

### 4. Authorise the site's domain

Go to [the Authentication settings page](https://console.firebase.google.com/project/_/authentication/settings)
and open the **Authorized domains** tab.

1. Click **Add domain**.
2. Type exactly:

   ```
   timothyhadfield.github.io
   ```

   No `https://`, no trailing slash, no `/fantasy-football`. Just the host.
3. Click **Add**.

`localhost` is already on the list, which is what makes it work if you ever run
the site locally. If you skip this step, sign-in fails on the live site with
`auth/unauthorized-domain` and nothing else tells you why.

### 5. Register a web app and copy the five values

Go to [Project settings](https://console.firebase.google.com/project/_/settings/general)
(the gear icon beside **Project Overview**, then **Project settings**).

1. Scroll to **Your apps** and click the **Web** icon — the one that looks like
   `</>`.
2. **App nickname**: `fantasy-football-site`.
3. Leave **Also set up Firebase Hosting for this app** **unticked**. The site is
   on GitHub Pages and does not want a second home.
4. Click **Register app**.
5. The next screen shows a code block containing a `firebaseConfig` object.
   Leave the page open — or come back to it any time via **Project settings →
   Your apps → SDK setup and configuration → Config**. It looks like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy................................",
     authDomain: "fantasy-football-a1b2c.firebaseapp.com",
     projectId: "fantasy-football-a1b2c",
     storageBucket: "fantasy-football-a1b2c.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef0123456789abcdef"
   };
   ```

You need four of them: `apiKey`, `authDomain`, `projectId`, `appId`. Ignore
`storageBucket` and `messagingSenderId` — nothing here uses Storage or
messaging.

**That `apiKey` is not a password.** It identifies the project, it ships in the
HTML of every Firebase web app in the world, and Google documents it as safe to
publish. It is going straight into this public repository on purpose. What
actually protects your data is the rules in the next step, and hiding the key
would buy nothing but the feeling of having done something.

### 6. Paste the config into the repo

Open [`js/cloud.js`](../js/cloud.js) and find the `DEFAULT_CONFIG` block near
the top. Fill in the four strings:

```js
export const DEFAULT_CONFIG = {
  apiKey: 'AIzaSy................................',
  authDomain: 'fantasy-football-a1b2c.firebaseapp.com',
  projectId: 'fantasy-football-a1b2c',
  appId: '1:123456789012:web:abcdef0123456789abcdef',
  ownerUid: '',        // <- sitting two fills this in
};
```

Leave `ownerUid` empty for now. Commit and push, then hard-refresh the site
(Ctrl+Shift+R) — GitHub Pages caches for ten minutes.

### 7. Paste the interim rules

Go to [the Firestore Rules tab](https://console.firebase.google.com/project/_/firestore/rules)
(or **Firestore → Rules**). Select everything in the editor and replace it with
this:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // The one account this data belongs to.
    //
    // Sitting two replaces the string below with your own user id. Until it
    // does, isOwner() is false for everybody — including you — so nothing can
    // be read or written. That is the correct state to leave it in overnight:
    // an empty locked box is fine, an open one is not.
    function isOwner() {
      return request.auth != null
          && request.auth.uid == 'PASTE-YOUR-USER-UID-IN-SITTING-TWO';
    }

    // Everything the site stores lives under /leagues. Both matches are
    // needed: the outer one for the league document itself, the inner one for
    // every season, week and wire document beneath it.
    match /leagues/{league} {
      allow read, write: if isOwner();

      match /{rest=**} {
        allow read, write: if isOwner();
      }
    }
  }
}
```

Click **Publish**.

Anything not matched by a rule is denied — that is Firestore's default and it
is why there is no "deny everything else" block at the bottom. A path outside
`/leagues` is already unreachable.

---

## In between: sign in once

Open the site on the desktop — the Edge profile with the bridge extension —
hard-refresh, and press the **Sign in with Google** button. Pick your account.

Sign-in works even though the rules currently deny everything: signing in and
being allowed to read are two different things. **Syncing will fail at this
point, and that is expected.** If it says the account is not the one the league
belongs to, or shows a permission error, that is the rules doing their job.

> **If the sign-in window does not appear**, your browser blocked the pop-up.
> Allow pop-ups for `timothyhadfield.github.io` and press the button again. The
> flow deliberately uses a pop-up rather than a redirect, because the redirect
> version has to read a cookie back on `github.io` that Safari blocks — the same
> third-party-cookie wall that stops the site reading ESPN directly.

---

## Sitting two — about two minutes

### 8. Find your user id

Go to [the Authentication users page](https://console.firebase.google.com/project/_/authentication/users).
Your account is the only row. The last column is **User UID** — a 28-character
string like `kJ8sQ2mNpL4vXrT9wYbZ3cDfGh1`. Hover it and click the copy icon.

### 9. Put it in the rules

Back on [the Rules tab](https://console.firebase.google.com/project/_/firestore/rules),
replace `PASTE-YOUR-USER-UID-IN-SITTING-TWO` with the uid you just copied,
keeping the quotes:

```
      return request.auth != null
          && request.auth.uid == 'kJ8sQ2mNpL4vXrT9wYbZ3cDfGh1';
```

Click **Publish**.

That is what makes the data yours. Any other person on earth can open the site,
read the `apiKey` out of it, and sign in with their own Google account — and
every read and every write they attempt returns "permission denied", because
their uid is not that string. The key being public does not matter, because the
key is not what is being checked.

### 10. Put it in the repo too

Optional, and worth the thirty seconds. Set `ownerUid` in
[`js/cloud.js`](../js/cloud.js) to the same string:

```js
  ownerUid: 'kJ8sQ2mNpL4vXrT9wYbZ3cDfGh1',
```

This changes nothing about security — the rules are what enforce it. It only
means that if you are ever signed into the wrong Google account, the site says
*"Signed in as other@gmail.com, which is not the account this league belongs
to"* instead of a bare permission error. Commit, push, hard-refresh.

### 11. Check it

On the desktop, press **Sync**. It should report writing 28 documents. Then
open the site on your phone: it should show your real league, with a note
saying how old the numbers are.

---

## Later, if you want to

**Let your league-mates read it.** One line in the rules — swap the uid
comparison for a list:

```
      return request.auth != null
          && request.auth.uid in [
               'kJ8sQ2mNpL4vXrT9wYbZ3cDfGh1',   // you
               'aB3cD4eF5gH6iJ7kL8mN9oP0qR1'    // whoever else
             ];
```

They each have to sign in once so you can read their uid out of the
**Authentication → Users** list. Note that this gives them *write* access as
well; splitting read from write is another two lines, worth doing if it ever
stops being just you.

**Turn it off.** Delete the four strings from `DEFAULT_CONFIG` in
[`js/cloud.js`](../js/cloud.js) and push. The site reverts to exactly what it
does today — the module goes inert, makes no network calls, and every page
renders as normal. Nothing else on the site depends on this.

---

## If something does not work

| What you see | What it is |
|---|---|
| `auth/unauthorized-domain` | Step 4 was skipped, or the domain was typed with `https://` on the front. |
| `auth/popup-blocked` | Allow pop-ups for the site, then press the button again. |
| "permission denied" on sync | The uid in the rules does not match the account you are signed in as. Re-check step 9 against **Authentication → Users**, including the quotes. |
| "Nothing has been synced for this league yet" on the phone | The desktop has not successfully synced. Do that first; the phone only ever reads. |
| Sync says a document is too big | Something upstream changed shape and started carrying ESPN's raw payload. The largest document this normally writes is 54 KB against a 1 MB limit, so this is a bug, not a capacity problem. |
| Everything works but the numbers are old | That is the design. The phone shows what the desktop last published; open the site on the computer to refresh it. |

## What is actually stored up there

Four kinds of document, all under `leagues/476225250/seasons/2026/`:

| Path | What | Size |
|---|---|---|
| (the season document itself) | League name, the ten managers, bye weeks, which weeks are present, when each part was last synced | 1.5 KB |
| `parts/schedule` | All 65 fixtures and results | 13 KB |
| `rosters/1` … `rosters/13` | All ten squads for that week, sixteen men each, with every projection | 53 KB each |
| `wire/1` … `wire/13` | The 150 most-owned free agents for that week | 36 KB each |

28 documents, about 1.15 MB a season. You can browse all of it in
[the Firestore data tab](https://console.firebase.google.com/project/_/firestore/data)
— the payloads are stored as plain JSON split into readable pieces, so nothing
about it is a black box.

Nothing is stored that the site does not draw, and demo data is never synced at
all.
