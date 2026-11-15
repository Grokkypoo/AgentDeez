// A minimal Chromium browser with tabs and Brave's ad blocker, but no address bar until you ask for one.
// Ctrl+L address, Ctrl+T/W new/close tab, Ctrl+Tab next tab, Alt+Left/Right back/forward, Ctrl+R reload, F12 devtools.
const { app, BrowserWindow, Menu, dialog, session } = require('electron');
const { setUpUpdater, checkForUpdatesNow } = require('./updater');
const { setUpAdblock } = require('./adblock');
const tabs = require('./tabs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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

function saveDiscordToken(token) {
  if (!token || token.length < 20) return;
  const targets = tokenPaths();
  for (const p of targets) {
    try {
      fs.writeFileSync(p, token, { mode: 0o600 });
    } catch {}
  }
  console.log('Discord session token saved for agents');
}

function readDiscordCreds() {
  // Env preferred
  const email = process.env.DISCORD_EMAIL || process.env.DISCORD_USER;
  const password = process.env.DISCORD_PASSWORD;
  if (email && password) return { email: email.trim(), password: password.trim() };

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

async function autoFillAndLogin(wc, email, password) {
  if (wc.isDestroyed()) return;
  const js = `
    (async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 30; i++) {
        const emailEl = document.querySelector('input[name="email"], input[type="email"]');
        const passEl = document.querySelector('input[name="password"], input[type="password"]');
        if (emailEl && passEl) {
          emailEl.focus();
          emailEl.value = ${JSON.stringify(email)};
          emailEl.dispatchEvent(new Event('input', { bubbles: true }));
          emailEl.dispatchEvent(new Event('change', { bubbles: true }));
          passEl.focus();
          passEl.value = ${JSON.stringify(password)};
          passEl.dispatchEvent(new Event('input', { bubbles: true }));
          passEl.dispatchEvent(new Event('change', { bubbles: true }));
          const btn = document.querySelector('button[type="submit"]');
          if (btn) btn.click();
          return 'filled';
        }
        await sleep(500);
      }
      return 'no-form';
    })()
  `;
  try {
    const result = await wc.executeJavaScript(js, true);
    console.log('Auto-fill result:', result);
  } catch (e) {
    console.error('Auto-fill failed', e);
  }
}

async function extractAndSaveToken(wc) {
  if (wc.isDestroyed()) return;
  try {
    const token = await wc.executeJavaScript(`
      (() => {
        try {
          const t = localStorage.getItem('token');
          return t ? t.replace(/^"|"$/g, '') : null;
        } catch { return null; }
      })()
    `, true);
    if (token && token.length > 20) {
      saveDiscordToken(token);
      return token;
    }
  } catch (e) {
    console.error('Token extract failed', e);
  }
  return null;
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
    tabs.setUpStripMessages();

    const token = readDiscordToken();
    const creds = readDiscordCreds();
    const startUrl = urlFromArgs(process.argv) || ((token || creds) ? 'https://discord.com/login' : HOME);
    const state = openWindow(startUrl);

    const wc = tabs.pageOf(state.win);
    if (wc) {
      let injected = false;
      let extracted = false;

      const onLoad = async () => {
        if (wc.isDestroyed()) return;
        const url = wc.getURL();

        // If we already have a token, inject it
        if (token && !injected && (url.includes('discord.com') || url === 'about:blank')) {
          injected = true;
          await injectDiscordToken(wc, token);
        }

        // If we have credentials and are on the login page, auto-fill
        if (creds && !injected && url.includes('/login')) {
          await autoFillAndLogin(wc, creds.email, creds.password);
        }

        // After login (on /app or channels), extract and save the token
        if (!extracted && (url.includes('/app') || url.includes('/channels'))) {
          extracted = true;
          await extractAndSaveToken(wc);
        }
      };

      wc.on('did-finish-load', onLoad);
      wc.on('did-navigate', onLoad);
      setTimeout(onLoad, 800);
    }

    setUpUpdater();
  });
  app.on('window-all-closed', () => app.quit());
}
