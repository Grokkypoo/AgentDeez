// Discord signup through the Arcane invite, up to the captcha.
// The invite asks for a display name and a birthday first. Email comes later.
// This module types those fields, submits, and sends one captcha-solver probe
// when a live hCaptcha frame is on screen. It does not click the puzzle.
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const state = {
  needsRefill: false,
  refillRunning: false,
  reloads: 0,
  probed: false,
  watching: false,
};

function isSignupUrl(url) {
  const custom = process.env.AGENTDEEZ_SIGNUP_URL;
  if (custom && url.includes(custom)) return true;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const pagePath = u.pathname.toLowerCase();
    // discord.gg/arcane redirects to /invite/<code> and that page is the account form.
    if (host === 'discord.gg' || host === 'www.discord.gg') return true;
    if (host.endsWith('discord.com') && /^\/invite(\/|$)/.test(pagePath)) return true;
    return /\/(register|signup|sign-up|create-account|join)(\/|$)/.test(pagePath);
  } catch {
    return false;
  }
}

function classifyCaptcha(text) {
  const blob = String(text || '').toLowerCase();
  // A live puzzle wins. The same frame can still contain "please try again".
  if (/drag the|select all|click each|click every|click on|listed in the guide|verify you are/.test(blob)) return 'live';
  if (/please try again/.test(blob)) return 'dead';
  if (/wait! are you human|please confirm you/.test(blob)) return 'loading';
  if (blob.trim()) return 'loading';
  return 'none';
}

function birthDate() {
  return {
    month: process.env.AGENTDEEZ_BIRTH_MONTH || 'March',
    day: process.env.AGENTDEEZ_BIRTH_DAY || '15',
    year: process.env.AGENTDEEZ_BIRTH_YEAR || '1996',
  };
}

async function focusField(wc, selector) {
  return wc.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    el.select && el.select();
    return document.activeElement === el;
  })()`, true);
}

// Birthday menus only render the visible rows. Scroll the option list until the row exists.
async function chooseDropdown(wc, label, text) {
  const script = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const wanted = ${JSON.stringify(text)};
    const textOf = el => ((el.innerText || el.textContent) || '').replace(/\\s+/g, ' ').trim();
    if (document.body) document.body.click();
    await sleep(60);
    const btn = document.querySelector('[aria-label=' + JSON.stringify(${JSON.stringify(label)}) + ']');
    if (!btn) return 'missing';
    btn.click();
    await sleep(200);
    let scroller = null;
    for (let i = 0; i < 50; i++) {
      const opts = [...document.querySelectorAll('[role="option"]')];
      const hit = opts.find(o => { const t = textOf(o); return t === wanted || t.startsWith(wanted + ' '); });
      if (hit) { hit.click(); return 'ok'; }
      if (!scroller && opts[0]) {
        let el = opts[0].parentElement;
        while (el && el !== document.body) {
          if (el.scrollHeight > el.clientHeight + 20) { scroller = el; break; }
          el = el.parentElement;
        }
      }
      if (scroller) scroller.scrollTop += Math.max(60, scroller.clientHeight - 8);
      await sleep(40);
    }
    const seen = [...document.querySelectorAll('[role="option"]')].slice(0, 6).map(o => textOf(o).slice(0, 12));
    return 'no-option:' + seen.join('|') + (scroller ? ':scrolled' : ':no-scroller');
  })()`;
  const result = await wc.executeJavaScript(script, true);
  return `${label}:${result}`;
}

async function fillField(wc, sel, value) {
  const found = await wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(sel)})`, true);
  if (!found) return false;
  if (!(await focusField(wc, sel))) return false;
  await wc.insertText(value);
  return true;
}

async function clickSubmit(wc) {
  return wc.executeJavaScript(`(() => {
    const box = document.querySelector('input[type="checkbox"]');
    if (box && !box.checked) box.click();
    const submit = document.querySelector('button[type="submit"]');
    if (!submit || submit.disabled || submit.getAttribute('aria-disabled') === 'true') return false;
    submit.click();
    return true;
  })()`, true);
}

// Values are typed through insertText. Lengths only are logged by the caller.
async function fillDiscordRegister(wc, email, password) {
  if (wc.isDestroyed()) return 'destroyed';
  const display = process.env.AGENTDEEZ_DISPLAY_NAME || 'Harbor Quill';
  const user = process.env.AGENTDEEZ_USERNAME || `harbor${Date.now().toString(36).slice(-6)}`;
  const born = birthDate();
  const displaySel = 'input[name="global_name"], input[aria-label="Display Name" i], input[placeholder*="call you" i]';
  const emailSel = 'input[name="email"], input[aria-label="Email" i], input[type="email"]';
  const userSel = 'input[name="username"], input[aria-label="Username" i]';
  const passSel = 'input[name="password"], input[aria-label="Password" i], input[type="password"]';
  try {
    const step = await wc.executeJavaScript(`(async () => {
      for (let i = 0; i < 40; i++) {
        const email = document.querySelector(${JSON.stringify(emailSel)});
        const pass = document.querySelector(${JSON.stringify(passSel)});
        const name = document.querySelector(${JSON.stringify(displaySel)});
        const month = document.querySelector('[aria-label="Month"]');
        if (email && pass) return 'account';
        if (name && month) return 'profile';
        await new Promise(r => setTimeout(r, 500));
      }
      return 'none';
    })()`, true);
    console.log('Register step', step);
    if (step === 'none') return 'no-form';
    if (step === 'profile') {
      if (!(await fillField(wc, displaySel, display))) return 'focus-failed';
      const dob = [];
      for (const [label, text] of [['Month', born.month], ['Day', born.day], ['Year', born.year]]) {
        dob.push(await chooseDropdown(wc, label, text));
      }
      const dobReady = dob.every((s) => s.endsWith(':ok'));
      const submitted = dobReady ? await clickSubmit(wc) : false;
      console.log('Register profile', JSON.stringify({ dob, submitted }));
      if (!submitted) return 'submit-disabled';
      // The invite shows the captcha before the email screen.
      const next = await wc.executeJavaScript(`(async () => {
        for (let i = 0; i < 30; i++) {
          if (document.querySelector(${JSON.stringify(emailSel)}) && document.querySelector(${JSON.stringify(passSel)})) return 'account';
          if (document.querySelector('iframe[src*="hcaptcha"], iframe[src*="captcha"]')) return 'captcha';
          await new Promise(r => setTimeout(r, 500));
        }
        return 'none';
      })()`, true);
      console.log('Register next', next);
      if (next === 'captcha') return 'captcha';
      if (next !== 'account') return 'no-account-step';
    }
    const filled = [
      await fillField(wc, emailSel, email),
      await fillField(wc, userSel, user),
      await fillField(wc, passSel, password),
    ];
    const submitted = await clickSubmit(wc);
    console.log('Register account', JSON.stringify({ filled, submitted }));
    return submitted ? 'submitted' : 'submit-disabled';
  } catch (e) {
    console.error('Register fill failed', String(e.message || e));
    return 'error';
  }
}

async function hcaptchaFrameText() {
  const port = process.env.AGENTDEEZ_CDP_PORT || '9222';
  const pages = await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/json`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.setTimeout(4000, () => { req.destroy(); reject(new Error('cdp list timeout')); });
    req.on('error', reject);
  });
  const page = pages.find((p) => p.type === 'page' && /discord\.com/.test(p.url || ''));
  if (!page || !page.webSocketDebuggerUrl) return '';
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
  });
  const call = (method, params, sessionId) => new Promise((resolve) => {
    const n = ++seq;
    pending.set(n, resolve);
    const payload = { id: n, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('cdp socket')), { once: true });
  });
  try {
    const targets = await call('Target.getTargets', {});
    const frames = (targets.result.targetInfos || []).filter((t) => t.type === 'iframe' && /hcaptcha/.test(t.url || ''));
    const bits = [];
    for (const frame of frames.slice(0, 2)) {
      const attached = await call('Target.attachToTarget', { targetId: frame.targetId, flatten: true });
      const result = await call('Runtime.evaluate', {
        expression: `(document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 240)`,
        returnByValue: true,
      }, attached.result.sessionId);
      const value = result.result && result.result.result && result.result.result.value;
      if (value && !value.startsWith(' /*')) bits.push(value);
    }
    return bits.join(' ');
  } finally {
    ws.close();
  }
}

function probeCaptchaBot() {
  if (state.probed) return;
  if (process.env.AGENTDEEZ_CAPTCHA_PROBE === '0') {
    state.probed = true;
    console.log('Captcha probe skipped');
    return;
  }
  state.probed = true;
  const task = [
    'Probe. A live hCaptcha is on the screen of this PC in the AgentDeez window titled Discord.',
    'The page is the Arcane invite, discord.gg/arcane, after the display name and birthday step.',
    'You are the Grok Bot installed on this PC. Reply whether you can see that window and are ready to solve the captcha.',
    'Do not use Tailscale. Do not use the Pi. Do not ask for a DevTools port.',
  ].join('\n');
  const bin = process.env.GROKBOT_ASK || path.join(os.homedir(), 'bin', 'grokbot-ask');
  const child = spawn(bin, ['captcha-solver', task], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  child.on('close', (code) => {
    const line = out.trim().split('\n')[0] || '';
    console.log('Captcha probe', code === 0 ? line.slice(0, 180) : `failed ${line.slice(0, 180)}`);
  });
}

// A dead hCaptcha session stays on "Please try again." Reload the invite and fill the same account.
async function watchSignupCaptcha(wc) {
  if (state.watching) return;
  state.watching = true;
  const started = Date.now();
  let loadingSince = 0;
  while (Date.now() - started < 90000 && !wc.isDestroyed()) {
    await new Promise((r) => setTimeout(r, 3000));
    let kind = 'none';
    try { kind = classifyCaptcha(await hcaptchaFrameText()); } catch (e) {
      console.error('Captcha frame read failed', String(e.message || e).slice(0, 200));
    }
    console.log('Captcha frame', kind);
    if (kind === 'live') {
      console.log('Live captcha on invite');
      probeCaptchaBot();
      state.watching = false;
      return;
    }
    const loadingTooLong = kind === 'loading' && loadingSince && Date.now() - loadingSince > 20000;
    if (kind === 'dead' || loadingTooLong) {
      if (state.reloads >= 2) {
        console.log('Captcha stayed dead');
        state.watching = false;
        return;
      }
      state.reloads += 1;
      state.needsRefill = true;
      state.watching = false;
      console.log('Reloading invite for a new captcha');
      await wc.loadURL('https://discord.gg/arcane');
      return;
    }
    if (kind === 'loading') { if (!loadingSince) loadingSince = Date.now(); }
    else loadingSince = 0;
  }
  state.watching = false;
  console.log('Captcha watch finished');
}

function selfTest() {
  const cases = [
    ['Drag the correct piece into the empty space Please try again.', 'live'],
    ['Click every animal icon listed in the guide', 'live'],
    ['Please try again.', 'dead'],
    ['Wait! Are you human?', 'loading'],
    ['', 'none'],
  ];
  for (const [text, want] of cases) {
    const got = classifyCaptcha(text);
    if (got !== want) throw new Error(`classify ${JSON.stringify(text)} => ${got}, want ${want}`);
  }
  const urls = [
    ['https://discord.gg/arcane', true],
    ['https://discord.com/invite/arcane', true],
    ['https://discord.com/register', true],
    ['https://discord.com/channels/1/2', false],
    ['https://example.com/', false],
  ];
  for (const [url, want] of urls) {
    const got = isSignupUrl(url);
    if (got !== want) throw new Error(`url ${url} => ${got}, want ${want}`);
  }
  const born = birthDate();
  if (born.month !== 'March' || born.day !== '15' || born.year !== '1996') {
    throw new Error('default birthday changed');
  }
  console.log('discord-signup self-test ok');
}

module.exports = {
  state,
  isSignupUrl,
  classifyCaptcha,
  fillDiscordRegister,
  watchSignupCaptcha,
  probeCaptchaBot,
};

if (require.main === module) selfTest();
