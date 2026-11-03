# running-rewards

A phone app that rewards runners. Run 5 km and you earn a discount at a partner café.

You can track your run in the app or connect Strava. When you pass 5 km you get a
reward that lasts 1 hour. You pick a café, show the reward to the staff and get your
discount.

The app is built with Expo (React Native). Accounts, cafés and rewards are stored in
Supabase.

## Set up

Follow these steps in order. You only do this once.

### 1. Install the programs on your computer

- **VS Code:** download it from [code.visualstudio.com](https://code.visualstudio.com) and install it.
- **Node.js:** download the **LTS** version from [nodejs.org](https://nodejs.org) and install it.
- **Git:** download it from [git-scm.com](https://git-scm.com) and install it. The default options are fine.

Restart your computer after installing.

### 2. Install Expo Go on your phone

- iPhone: get **Expo Go** from the App Store.
- Android: get **Expo Go** from the Play Store.

Open Expo Go and log in with your Expo account. If you don't have one, sign up for
free at [expo.dev](https://expo.dev).

### 3. Get the code from GitHub

You need an invite to the GitHub project first. Ask the project owner.

1. Open VS Code.
2. Click **Clone Git Repository** on the start screen. (Or press `Ctrl+Shift+P` and type
   `Git: Clone`.)
3. Paste this link and press Enter:
   ```
   https://github.com/eliegamala/running-rewards.git
   ```
4. Pick a folder to save it in.
5. Click **Open** when VS Code asks.

### 4. Install the project

1. In VS Code, open the terminal: **Terminal → New Terminal**.
2. Type this and press Enter:
   ```bash
   npm install
   ```
3. Wait until it finishes. It can take a few minutes.

### 5. Add the settings file

The app needs two settings to connect to the database.

1. In VS Code, click **File → New File**.
2. Paste in these two lines:
   ```
   EXPO_PUBLIC_SUPABASE_URL=
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
   ```
3. Ask the project owner for the two values and paste them after the `=` signs.
4. Save the file in the main project folder with the name `.env.local` (it starts with
   a dot).

This file stays on your computer. It is never uploaded to GitHub.

### 6. Log in to Expo on your computer

In the VS Code terminal, type:

```bash
npx expo login
```

Use the same Expo account as on your phone.

### 7. Start the app

In the terminal, type:

```bash
npx expo start
```

A QR code shows up in the terminal.

- **iPhone:** open the Camera app and point it at the QR code.
- **Android:** open Expo Go and tap **Scan QR code**.

The app opens on your phone. Sign up with your email and you're in.

## Every day after that

Open the project in VS Code, open the terminal and type:

```bash
npx expo start
```

Then open the app in Expo Go on your phone. When you save a file in VS Code, the app
updates on your phone by itself.

To get the latest code from the team, click the **Source Control** icon on the left in
VS Code and click **Sync Changes**. Or type `git pull` in the terminal.

## If something doesn't work

- **The phone can't connect:** make sure your phone and computer are on the same Wi-Fi.
  If it still doesn't work, stop the app with `Ctrl+C` and start it with
  `npx expo start --tunnel`.
- **Strange errors after getting new code:** run `npm install` again, then
  `npx expo start --clear`.
- **The app says it can't connect to the server:** check your `.env.local` file. The
  name and the two values must be exactly right.

## Test a reward without running

Start a run on the RUN screen and tap **DEV · Simulate 5 km**. You get a reward
straight away.

Good to know: in Expo Go, the run stops tracking when your screen locks, and
notifications don't arrive. Everything else works.

## Before you share your code

Run these two checks in the terminal. Both must finish with no errors.

```bash
npx tsc --noEmit
npx expo lint
```

To add a new package, use `npx expo install <package-name>`, not `npm install`.
