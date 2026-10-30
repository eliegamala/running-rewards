# running-rewards

## What is this?

A phone app that rewards runners. Run 5 km and you earn a discount at a partner café.

- You can track your run in the app, or connect Strava.
- When you pass 5 km, you get a reward. It lasts 1 hour.
- You pick a café, show the reward to the staff, and get your discount.

The app is built with **Expo** (React Native). The backend is **Supabase**: it holds the
accounts, the cafés and the rewards. The server decides who earns a reward, not the app.

## Set up

### Step 1: Install the tools

- [Node.js](https://nodejs.org) version 22 or newer
- [Git](https://git-scm.com)
- To run the app on Android: [Android Studio](https://developer.android.com/studio)
- To run the app on iPhone: a Mac with Xcode

### Step 2: Get the code

```bash
git clone https://github.com/eliegamala/running-rewards.git
cd running-rewards
npm install
```

### Step 3: Add the settings file

Make a copy of the example file:

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in the two values. Ask the project owner for them.

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Only put these two values here. Never put a secret key in this file, because it gets
built into the app.

### Step 4: Build the app on your phone

Plug in your phone (or start an emulator), then run:

```bash
npx expo run:android
```

On a Mac, use `npx expo run:ios` for iPhone.

This takes a few minutes the first time. You only need to do it again when you add a
new package or change `app.json`.

### Step 5: Start the app

```bash
npx expo start
```

Open the app on your phone. It connects to the dev server.

### Step 6: Make an account

Sign up in the app with your email. You're ready.

## Test a reward without running

On the RUN screen, start a run and tap **DEV · Simulate 5 km**. It adds a fake 5 km
route and you get a reward straight away. This button only shows in development builds.

## Before you push code

Run these two checks. Both must pass.

```bash
npx tsc --noEmit
npx expo lint
```

To add a package, use `npx expo install <package>`, not `npm install`. It picks the
right version for this Expo version.

## Where things are

| Folder | What's in it |
|---|---|
| `src/app/` | The screens. Each file is a page in the app. |
| `src/components/` | Buttons, cards and other shared pieces |
| `src/lib/` | The logic: run tracking, rewards, Strava, cafés |
| `supabase/migrations/` | The database: tables and reward rules |
| `supabase/functions/` | Server code for Strava and account deletion |
| `docs/legal/` | Privacy policy and terms |

Don't create or edit `ios/` or `android/` folders. They are made for you when you
build.

## The reward rules

These rules are checked by the database, so they can't be skipped from the app.

1. A run or walk of 5 km or more earns one reward.
2. Only your newest run counts. Old runs never earn.
3. You can only have one reward at a time.
4. A reward lasts 1 hour and works at one café, once.
5. For runs tracked in the app, the server checks the GPS route and measures the
   distance itself.

If you change how the app measures distance (`src/lib/run-tracker.ts`), make the same
change on the server (`supabase/migrations/20261030120000_gps_route_check.sql`).

## Working on the backend

You only need this if you change the database or the server code. Ask the project owner
to add you to the Supabase project first.

Connect to the project:

```bash
npx supabase login
npx supabase link --project-ref dxwiggqimnyxyotjwaeu
```

**To change the database:** add a new file in `supabase/migrations/`. Don't edit old
files. Then run:

```bash
npx supabase db push --linked
```

Be careful: there's only one database, and it's the live one. Talk to the team before
you push.

**To update server code:**

```bash
npx supabase functions deploy <name>
```

## Admin access

The admin area lets you edit cafés and see reward numbers. To make someone an admin,
the project owner runs this in the Supabase SQL editor:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'someone@example.com';
```

The first time they open the admin area, the app asks them to set up two-step login.

## Known issues

- Strava only lets a few people connect until our Strava app is approved. If connecting
  Strava fails, that's probably why.
- Some cafés show placeholder product photos.
- There's no cloud build setup (EAS) yet. Builds only run on your own computer.
