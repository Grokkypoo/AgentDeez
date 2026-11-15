// A minimal Chromium browser with tabs and Brave's ad blocker, but no address bar until you ask for one.
// Ctrl+L address, Ctrl+T/W new/close tab, Ctrl+Tab next tab, Alt+Left/Right back/forward, Ctrl+R reload, F12 devtools.
const { app, BrowserWindow, Menu, dialog, session } = require('electron');
const { setUpUpdater, checkForUpdatesNow } = require('./updater');
const { setUpAdblock } = require('./adblock');
const tabs = require('./tabs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const infisical = require('./infisical');

// Reduce a few common automation signals before the app is ready.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,site-per-process');
// Optional: force a more consumer-like GPU process if software rendering is an issue.
// app.commandLine.appendSwitch('use-gl', 'desktop');

// One fixed profile for source runs and the AppImage, so the Discord session persists across both.
// Override with AGENTDEEZ_PROFILE_DIR.
app.setPath('userData', process.env.AGENTDEEZ_PROFILE_DIR || path.join(app.getPath('appData'), 'AgentDeez'));

// With Infisical configured, plaintext token/cred files are neither read nor written unless
// AGENTDEEZ_TOKEN_FILES=1. Without Infisical, files stay on (old behavior) unless AGENTDEEZ_TOKEN_FILES=0.
const USE_INFISICAL = infisical.isConfigured();
const USE_TOKEN_FILES = process.env.AGENTDEEZ_TOKEN_FILES ? process.env.AGENTDEEZ_TOKEN_FILES === '1' : !USE_INFISICAL;

const HOME = 'https://duckduckgo.com/';
const ASK = new Set(['media', 'geolocation', 'notifications', 'display-capture', 'clipboard-read']);
const GO = 'https://cozybrowsin.invalid/go?u=';

// Applies to every page, including popups. Pages see a normal Chrome UA.
app.userAgentFallback = app.userAgentFallback.replace(/ (Electron|cozybrowsin)\/\S+/gi, '');

const urlFromArgs = argv => argv.slice(1).find(a => /^https?:\/\//i.test(a));

function toUrl(text) {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[^\s]+\.[^\s]+$/.test(t)) return `https://${t}`;
  return `${HOME}?q=${encodeURIComponent(t)}`;
}

function tokenPaths() {
  return [
    path.join(os.tmpdir(), 'dtok.txt'),
    path.join(os.tmpdir(), 'discord-token.txt'),
    path.join(app.getPath('userData'), 'discord-token.txt'),
  ];
}

function readDiscordToken() {
  if (process.env.DISCORD_TOKEN) return process.env.DISCORD_TOKEN.trim();
  if (!USE_TOKEN_FILES) return null;
  for (const p of tokenPaths()) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8').trim();
        if (raw && raw.length > 20) return raw;
      }
    } catch {}
  }
  return null;
}

async function saveDiscordToken(token) {
  if (!token || token.length < 20) return;
  if (USE_INFISICAL) {
    if (token === (process.env.DISCORD_TOKEN || '').trim()) {
      console.log('Discord session token unchanged; Infisical already current');
    } else {
      try {
        await infisical.saveToken(token);
        process.env.DISCORD_TOKEN = token;
        console.log('Discord session token saved to Infisical');
      } catch (e) {
        console.error(String(e.message || e));
      }
    }
  }
  if (!USE_TOKEN_FILES) return;
  const targets = tokenPaths();
  for (const p of targets) {
    try {
      fs.writeFileSync(p, token, { mode: 0o600 });
    } catch {}
  }
  console.log('Discord session token saved to token files');
}

function readDiscordCreds() {
  // Env preferred
  const email = process.env.DISCORD_EMAIL || process.env.DISCORD_USER;
  const password = process.env.DISCORD_PASSWORD;
  if (email && password) return { email: email.trim(), password: password.trim() };
  if (!USE_TOKEN_FILES) return null;

  // File: %TEMP%/discord-creds.json or userData
  const candidates = [
    path.join(os.tmpdir(), 'discord-creds.json'),
    path.join(app.getPath('userData'), 'discord-creds.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j.email && j.password) return { email: j.email.trim(), password: j.password.trim() };
      }
    } catch {}
  }
  return null;
}

const DISCORD_LOGIN_JS = `
function login(token) {
  if (!token || typeof token !== 'string') return;
  const quoted = '"' + token.replace(/"/g, '') + '"';
  const interval = setInterval(() => {
    try {
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      iframe.contentWindow.localStorage.token = quoted;
      iframe.remove();
    } catch (e) {}
  }, 50);
  setTimeout(() => {
    clearInterval(interval);
    location.reload();
  }, 1500);
}
`;

async function injectDiscordToken(wc, token) {
  if (!token || wc.isDestroyed()) return;
  try {
    await wc.executeJavaScript(DISCORD_LOGIN_JS + `login(${JSON.stringify(token)});`, true);
  } catch (e) {
    console.error('Discord token inject failed', e);
  }
}

// Discord's login form is React-controlled, so assigning .value is ignored. Focus each field from the page,
// then type through webContents.insertText, which goes through Chromium's real text input path.
async function focusField(wc, selector) {
  return wc.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    el.select && el.select();
    return document.activeElement === el;
  })()`, true);
}

async function autoFillAndLogin(wc, email, password) {
  if (wc.isDestroyed()) return 'destroyed';
  const EMAIL = 'input[name="email"], input[type="email"]';
  const PASS = 'input[name="password"], input[type="password"]';
  try {
    const ready = await wc.executeJavaScript(`(async () => {
      for (let i = 0; i < 60; i++) {
        if (document.querySelector(${JSON.stringify(EMAIL)}) && document.querySelector(${JSON.stringify(PASS)})) return true;
        await new Promise(r => setTimeout(r, 500));
      }
      return false;
    })()`, true);
    if (!ready) { console.log('Auto-fill result: no-form'); return 'no-form'; }
    for (const [sel, val] of [[EMAIL, email], [PASS, password]]) {
      if (!(await focusField(wc, sel))) { console.log('Auto-fill result: focus-failed'); return 'focus-failed'; }
      await wc.insertText(val);
    }
    const lens = await wc.executeJavaScript(`[document.querySelector(${JSON.stringify(EMAIL)}).value.length, document.querySelector(${JSON.stringify(PASS)}).value.length]`, true);
    const ok = lens[0] === email.length && lens[1] === password.length;
    console.log(`Auto-fill result: ${ok ? 'filled' : 'mismatch'} (email ${lens[0]}/${email.length} chars, password ${lens[1]}/${password.length} chars)`);
    await wc.executeJavaScript(`(() => { const b = document.querySelector('button[type="submit"]'); if (b) b.click(); return !!b; })()`, true);
    setTimeout(() => reportLoginState(wc), 6000);
    return ok ? 'filled' : 'mismatch';
  } catch (e) {
    console.error('Auto-fill failed', String(e.message || e));
    return 'error';
  }
}

// What the login page shows after submit, without any field values: captcha, MFA, verification or error text.
async function reportLoginState(wc) {
  if (wc.isDestroyed()) return;
  try {
    const s = await wc.executeJavaScript(`(() => {
      const q = s => document.querySelector(s);
      const errs = [...document.querySelectorAll('[class*="error"], [class*="errorMessage"]')].map(e => e.textContent.trim()).filter(Boolean).slice(0, 5);
      return {
        path: location.pathname,
        captcha: !!q('iframe[src*="hcaptcha"], iframe[src*="captcha"], [class*="captcha"]'),
        mfa: !!q('input[autocomplete="one-time-code"], input[placeholder*="6-digit"], input[maxlength="6"]'),
        heading: (q('h1, h2, h3') || {}).textContent || '',
        errors: errs,
      };
    })()`, true);
    console.log('Login state:', JSON.stringify(s));
  } catch (e) {
    console.error('Login state check failed', String(e.message || e));
  }
}

// Discord removes window.localStorage from the page, so read it through a fresh same-origin iframe.
const READ_TOKEN_JS = `(() => {
  try {
    const f = document.createElement('iframe');
    f.style.display = 'none';
    document.body.appendChild(f);
    const t = f.contentWindow.localStorage.getItem('token');
    f.remove();
    return t ? t.replace(/^"|"$/g, '') : null;
  } catch { return null; }
})()`;

// Authorization header from the page's own API calls, kept in memory only as a fallback source.
let seenAuthHeader = null;
function watchDiscordAuth(ses) {
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://discord.com/api/*', 'https://*.discord.com/api/*'] }, (details, cb) => {
    const h = details.requestHeaders.Authorization || details.requestHeaders.authorization;
    if (h && h.length > 20 && !h.startsWith('Bot ')) seenAuthHeader = h;
    cb({ requestHeaders: details.requestHeaders });
  });
}

// Poll for the session token after login, then save it. Returns true once saved.
async function extractAndSaveToken(wc, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (wc.isDestroyed()) return false;
    let token = null;
    try { token = await wc.executeJavaScript(READ_TOKEN_JS, true); } catch {}
    if (!(token && token.length > 20)) token = seenAuthHeader;
    if (token && token.length > 20) {
      await saveDiscordToken(token);
      return true;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('Token extract: no token found after login');
  return false;
}

const openWindow = url => tabs.openWindow(url, HOME);

function askForAddress(win) {
  const target = tabs.pageOf(win);
  if (!target) return;
  const box = new BrowserWindow({ parent: win, width: 640, height: 90, resizable: false, minimizable: false, autoHideMenuBar: true, title: 'Go to', webPreferences: { sandbox: true, contextIsolation: true } });
  box.setMenuBarVisibility(false);
  // The page has no bridge to this process. Its one navigation is caught here and never loads.
  box.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(GO)) return;
    e.preventDefault();
    const text = decodeURIComponent(url.slice(GO.length));
    box.close();
    if (text.trim() && !target.isDestroyed()) target.loadURL(toUrl(text));
  });
  const value = JSON.stringify(target.getURL()).replace(/</g, '\\u003c');
  const html = `<!doctype html><title>Go to</title><style>body{margin:12px;font:15px system-ui}input{width:100%;box-sizing:border-box;padding:8px;font:inherit}</style>
<form id=f><input id=a autofocus spellcheck=false></form><script>
a.value=${value};a.select();
f.onsubmit=e=>{e.preventDefault();location.href=${JSON.stringify(GO)}+encodeURIComponent(a.value)};
addEventListener('keydown',e=>{if(e.key==='Escape')close()});
</script>`;
  box.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

const onFocused = fn => (_item, win) => { if (win) fn(win); };
const onPage = fn => onFocused(win => { const page = tabs.pageOf(win); if (page) fn(page); });
const tabNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ label: `Tab ${n}`, accelerator: `CmdOrCtrl+${n}`, click: onFocused(tabs.pickTab(n)) }));
const menu = Menu.buildFromTemplate([{ label: 'Browse', submenu: [
  { label: 'Address', accelerator: 'CmdOrCtrl+L', click: onFocused(askForAddress) },
  { label: 'Back', accelerator: 'Alt+Left', click: onPage(p => p.navigationHistory.goBack()) },
  { label: 'Forward', accelerator: 'Alt+Right', click: onPage(p => p.navigationHistory.goForward()) },
  { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: onPage(p => p.reload()) },
  { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: onFocused(tabs.newTab) },
  { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: onFocused(tabs.closeActive) },
  { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: onFocused(tabs.reopenClosed) },
  { label: 'Next Tab', accelerator: 'CmdOrCtrl+Tab', click: onFocused(tabs.stepTab(1)) },
  { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+Tab', click: onFocused(tabs.stepTab(-1)) },
  ...tabNumbers,
  { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => openWindow() },
  { label: 'Developer Tools', accelerator: 'F12', click: onPage(p => p.toggleDevTools()) },
  { label: 'Check for Updates', click: () => checkForUpdatesNow() },
  { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
] }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => tabs.openInLastWindow(urlFromArgs(argv), HOME));
  app.whenReady().then(() => {
    Menu.setApplicationMenu(menu);
    // Electron grants everything if there is no handler. Ask once per site per run for sensitive permissions.
    const decisions = new Map();
    const originOf = url => { try { return new URL(url).origin; } catch { return ''; } };
    session.defaultSession.setPermissionRequestHandler(async (wc, permission, cb) => {
      if (!ASK.has(permission)) return cb(true);
      const key = `${originOf(wc.getURL())} ${permission}`;
      if (decisions.has(key)) return cb(decisions.get(key));
      const win = tabs.ownerWindow(wc);
      const { response } = await dialog.showMessageBox(win, { type: 'question', buttons: ['Block', 'Allow'], defaultId: 0, cancelId: 0, message: `${originOf(wc.getURL())} wants: ${permission}` });
      decisions.set(key, response === 1);
      cb(response === 1);
    });
    // Media must pass this check to reach the prompt above. Everything else follows the saved answer.
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => {
      if (permission === 'media' || !ASK.has(permission)) return true;
      return decisions.get(`${originOf(origin)} ${permission}`) === true;
    });
    setUpAdblock(session.defaultSession, tabs.countBlocked);
    watchDiscordAuth(session.defaultSession);
    tabs.setUpStripMessages();

    const token = readDiscordToken();
    const creds = readDiscordCreds();
    const startUrl = urlFromArgs(process.argv) || ((token || creds) ? 'https://discord.com/login' : HOME);
    const state = openWindow(startUrl);

    const wc = tabs.pageOf(state.win);
    if (wc) {
      let injected = false;
      let injectedAt = 0;
      let filling = false;
      let extracting = false;
      let extracted = false;

      const onLoad = async () => {
        if (wc.isDestroyed()) return;
        const url = wc.getURL();

        // If we already have a token, inject it
        if (token && !injected && (url.includes('discord.com') || url === 'about:blank')) {
          injected = true;
          injectedAt = Date.now();
          await injectDiscordToken(wc, token);
          return;
        }

        // If we have credentials and are on the login page, auto-fill once. With a stored token this only
        // happens when Discord bounced back to /login after the injected token's reload (token expired).
        if (creds && !filling && url.includes('/login') && (!injected || Date.now() - injectedAt > 3000)) {
          filling = true;
          await autoFillAndLogin(wc, creds.email, creds.password);
        }

        // After login (on /app or channels), extract and save the token
        if (!extracted && !extracting && (url.includes('/app') || url.includes('/channels'))) {
          extracting = true;
          extracted = await extractAndSaveToken(wc);
          extracting = false;
        }
      };

      wc.on('did-finish-load', onLoad);
      wc.on('did-navigate', onLoad);
      // Discord moves from /login to /channels with pushState, which only fires did-navigate-in-page.
      wc.on('did-navigate-in-page', onLoad);
      setTimeout(onLoad, 800);
    }

    setUpUpdater();
  });
  app.on('window-all-closed', () => app.quit());
}
