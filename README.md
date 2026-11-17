# AgentDeez

Agent-focused fork of [CozyBrowsin](https://github.com/Grokkypoo/CozyBrowsin). A minimal Chromium browser with tabs and Brave's ad blocker, plus automatic Discord login and session token extraction for agents.

It has its own profile so Discord sessions persist across launches.

Includes a lightweight stealth preload (`stealth-preload.js`) and a few Electron command-line switches that reduce common automation tells (navigator.webdriver, canvas/WebGL/audio fingerprint noise, AutomationControlled). Session-stable noise so fingerprints stay consistent within a run.

## Discord login for agents

Two modes:

### 1. Auto-fill credentials → extract token (recommended for first-time)

Provide email + password via:

- Environment: `DISCORD_EMAIL=you@example.com` and `DISCORD_PASSWORD=yourpass`
- Or file: `%TEMP%\discord-creds.json` (or in userData) with:
  ```json
  { "email": "you@example.com", "password": "yourpass" }
  ```

AgentDeez opens the Discord login page, fills the form, and submits. After login succeeds it extracts the session token from `localStorage` and writes it to the token files for future use / other agents.

### 2. Existing token injection

If a token already exists, put it in:

- `DISCORD_TOKEN` env var
- `%TEMP%\dtok.txt` or `/tmp/dtok.txt`
- `%TEMP%\discord-token.txt`
- App userData `discord-token.txt`

It injects the token and you are signed in immediately.

**Token output locations** (written after successful login):

- `%TEMP%\dtok.txt`
- `%TEMP%\discord-token.txt`
- App userData `discord-token.txt`

Quit with Ctrl+Q the first time so the Electron session is fully flushed.

## Discord signup up to the captcha

`scripts/signup-until-captcha.sh` opens `https://discord.gg/arcane` in a separate profile (`~/.config/AgentDeez-signup`). That invite shows a display name and a birthday first. The script fills those, submits, and stops when a live hCaptcha is on screen. It sends one probe to the `captcha-solver` destination and does not click the puzzle. The window stays open.

```bash
bash scripts/signup-until-captcha.sh
```

Defaults are display name `Harbor Quill` and birthday March 15, 1996. Override with `AGENTDEEZ_DISPLAY_NAME`, `AGENTDEEZ_BIRTH_MONTH`, `AGENTDEEZ_BIRTH_DAY`, and `AGENTDEEZ_BIRTH_YEAR`. The mail control center (`outlook-email-automation`, next to this repo, or `OUTLOOK_AUTOMATION_ROOT`) reserves the address. With `softeria` it only reserves the address. `AGENTDEEZ_USE_RELAY=1` asks for a Firefox Relay mask.

`node scripts/discord-signup.js` checks the captcha classifier and the invite URL match without opening a window.

After the captcha, the same run can fill the email, username, and password when that screen appears. A one-time code field calls `wait-verification` and types the code or opens the confirm link. The mailbox has to be readable (`MAIL_BACKEND=thunderbird` or `graph`) for that step.

## Credentials from local Infisical

With `INFISICAL_PROJECT_ID` plus Universal Auth client creds (or `INFISICAL_TOKEN`) in the environment, AgentDeez:

- gets `DISCORD_TOKEN`, `DISCORD_EMAIL`, `DISCORD_PASSWORD` as env vars from `infisical run`
- writes a freshly extracted token back to the `DISCORD_TOKEN` secret over the Infisical API
- skips all plaintext token/cred files (set `AGENTDEEZ_TOKEN_FILES=1` to keep them)

Launch with `./run-agentdeez.sh`. It reads `~/.config/agentdeez/infisical-identity.env` (chmod 600, template in `infisical-identity.env.example`), logs in the machine identity, and runs the AppImage from `dist/` or, with `AGENTDEEZ_FROM_SOURCE=1`, `npx electron .`.

The browser profile (cookies, Discord session) lives in `~/.config/AgentDeez` for both source and AppImage runs. Override with `AGENTDEEZ_PROFILE_DIR`.

## Run from source

```bash
npm install
npm run fetch-filters
npx electron .
```

## Build

```bash
COZYBROWSIN_UPDATE_URL=https://github.com/OWNER/REPO/releases/latest/download npm run dist:linux
```

## Keys

| Key | Action |
|---|---|
| Ctrl+L | Type an address or search |
| Alt+Left / Alt+Right | Back / forward |
| Ctrl+R | Reload |
| Ctrl+T | New tab |
| Ctrl+W | Close tab, and the window with its last tab |
| Ctrl+Shift+T | Reopen closed tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+1 to Ctrl+8, Ctrl+9 | Pick a tab, last tab |
| Ctrl+N | New window |
| F12 | Developer tools |
| Ctrl+Q | Quit |

## Good to know

- Middle-click a tab to close it. Ctrl+click or middle-click a link to open it in a new tab.
- Camera, mic, location, notifications, screen capture and clipboard reading ask first. Answers last until you quit.
- Chromium saves cookies on a delay, so a crash or force-kill can lose very recent logins. Quit with Ctrl+Q.
- Ad blocking uses Brave's `adblock-rust` engine with Brave's default lists, minus the mobile-only ones. Lists refresh daily and apply at the next start.
- The button at the top right shows how many requests were blocked on the page. Click it to turn blocking off for that site, for example if blocking breaks it.
- Stealth preload (`stealth-preload.js`) applies session-stable canvas / WebGL / audio noise and hides `navigator.webdriver`. Not a full anti-detect browser; higher-end systems still look at TLS, timing, and behavioral signals.
- It has no password manager or Safe Browsing.
- It only gets browser security fixes when a new release is published, so publish regularly.
- To change the home page or search engine, edit `HOME` in `main.js`.
