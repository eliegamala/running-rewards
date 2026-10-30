# running-rewards

Mobile app where a 5 km run earns a free drink at a partner café. Runs come from the
built-in GPS tracker or from Strava. Rewards are issued and checked by the server,
never by the app.

Stack: Expo SDK 58 (React Native 0.88, Expo Router), TypeScript, Supabase (Postgres,
Auth, Storage, Edge Functions).

## Setup

You need Node 22+ and git. For a device build: Android Studio (Android) or Xcode on a
Mac (iOS).

```bash
git clone https://github.com/eliegamala/running-rewards.git
cd running-rewards
npm install
cp .env.example .env.local
```

Fill in `.env.local`. Ask the project owner for the values, or copy them from the
Supabase dashboard (Project Settings → API Keys):

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Only the publishable key goes here. Never put a secret or service-role key in
`.env.local`; everything prefixed `EXPO_PUBLIC_` ends up in the app bundle.

## Running

The app uses background location and push notifications, so use a development build:

```bash
npx expo run:android   # or: npx expo run:ios (Mac only)
```

That builds and installs the app once. After that, just start the dev server:

```bash
npx expo start
```

Rebuild with `run:android` / `run:ios` whenever you add a package with native code or
change `app.json`.

Expo Go also works for most screens, but runs stop tracking when the screen locks and
notifications won't arrive.

Sign up in the app with any email to get an account. Everything runs against the shared
Supabase project, so there is no local backend to start.

### Testing rewards without running

In development builds the RUN screen has a **DEV · Simulate 5 km** button. It generates
a plausible 5 km route that the server accepts, so you can test the reward flow at your
desk. It's hidden in release builds, but remove it before launch.

## Before you push

```bash
npx tsc --noEmit
npx expo lint
```

Both should pass with no errors.

Install packages with `npx expo install <package>`, not `npm install <package>`. It
picks the version that matches the SDK.

## Project layout

```
src/
  app/            Screens. Every file is a route (Expo Router); _layout.tsx files are navigators.
    (app)/        Signed-in tabs: home, run, rewards, profile, strava, reward pass
    admin/        Admin area (café editing, reward stats)
  components/     Shared UI
  hooks/
  lib/            Non-UI logic
    run-tracker.ts    GPS tracking and distance filtering
    reward-credit.ts  Reward state, GPS route upload and reward claims
    strava.ts         Strava connection and sync
    stores.ts         Cafés
    supabase.ts       Supabase client
supabase/
  migrations/     Database schema, RLS policies and reward rules (SQL)
  functions/      Edge functions: strava, strava-callback, strava-webhook, delete-account
docs/legal/       Privacy policy and terms
```

`ios/` and `android/` are generated and git-ignored. Don't edit them; configure native
settings in `app.json`.

## How rewards work

The rules live in the database (`supabase/migrations`), not the app:

- A run or walk of 5 km or more earns one reward. It's valid for 1 hour and is used once,
  at one café.
- Only your newest run can earn. Old runs, a first Strava sync or reconnecting Strava
  never earn.
- One active reward at a time.
- GPS runs: when a run passes 5 km the app uploads the route and the server measures the
  distance itself, using the same filtering as `run-tracker.ts`. If you change the
  filtering on one side, change it on the other (`claim_gps_reward` in
  `20261030120000_gps_route_check.sql`).
- Strava runs come in through the webhook. Manual activities never count.

## Backend work

Only needed if you're changing the database or edge functions. Ask the project owner to
invite you to the Supabase project first.

```bash
npx supabase login
npx supabase link --project-ref dxwiggqimnyxyotjwaeu
```

**Database changes:** add a new file to `supabase/migrations/` named
`YYYYMMDDHHMMSS_description.sql`. Never edit a migration that has already been applied.
Then:

```bash
npx supabase migration list --linked   # see what's applied
npx supabase db push --linked          # apply new migrations
```

There's no staging database yet, so `db push` changes the live project. Check with the
team before pushing.

**Edge functions:**

```bash
npx supabase functions deploy <name>
```

They read their secrets (Strava client ID/secret, token encryption key, webhook token)
from Supabase. Those are already set on the project. To change them, use
`supabase/.env.functions.local` (git-ignored, ask the owner) and
`npx supabase secrets set --env-file supabase/.env.functions.local`. Don't change
`STRAVA_TOKEN_ENCRYPTION_KEY`; stored Strava tokens become unreadable.

## Admin access

Admin accounts are listed in the `admins` table and need two-step login (set up in the
app the first time you open the admin area). To make an account an admin, the owner
runs this in the Supabase SQL editor:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'someone@example.com';
```

## Known limitations

- Strava limits how many athletes can connect until the API app is approved. If
  connecting Strava fails for a new account, that's probably why.
- Café product photos are placeholders for cafés that haven't sent their own.
- No EAS build config yet, so builds are local only.
