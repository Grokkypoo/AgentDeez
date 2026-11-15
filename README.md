# AgentDeez

Agent-focused fork of [CozyBrowsin](https://github.com/Grokkypoo/CozyBrowsin). A minimal Chromium browser with tabs and Brave's ad blocker, plus automatic Discord session login for agents.

It has its own profile so Discord sessions persist across launches.

## Discord login for agents (automatic)

Put the token in one of these places before starting:

- Environment variable: `DISCORD_TOKEN=your_token_here`
- File: `%TEMP%\\dtok.txt` (Windows) or `/tmp/dtok.txt` (Linux/macOS)
- File: `%TEMP%\\discord-token.txt` or the app's userData folder `discord-token.txt`

If a token is found, AgentDeez opens `https://discord.com/app` and automatically injects it. The page reloads and you are signed in. Quit with Ctrl+Q so the session is flushed to disk.

Agents can simply write the token to `%TEMP%\\dtok.txt` (or set the env var) and launch the browser.

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
