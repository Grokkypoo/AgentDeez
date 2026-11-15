# AgentDeez

Agent-focused fork of [CozyBrowsin](https://github.com/Grokkypoo/CozyBrowsin). A minimal Chromium browser with tabs and Brave's ad blocker, plus automatic Discord login and session token extraction for agents.

It has its own profile so Discord sessions persist across launches.

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
- It doesn't have Brave's other protections, such as fingerprint randomizing, or uBlock's procedural (`:has-text`-style) element hiding.
- It has no password manager or Safe Browsing.
- It only gets browser security fixes when a new release is published, so publish regularly.
- To change the home page or search engine, edit `HOME` in `main.js`.
