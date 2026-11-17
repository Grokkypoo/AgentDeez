// Talks to the local Outlook control center. Passwords and codes stay in the returned
// objects; this module does not print them.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function rootDir() {
  if (process.env.OUTLOOK_AUTOMATION_ROOT) return process.env.OUTLOOK_AUTOMATION_ROOT;
  const sibling = path.resolve(__dirname, '..', 'outlook-email-automation');
  if (fs.existsSync(path.join(sibling, 'src', 'outlook_automation', '__main__.py'))) return sibling;
  return path.join(process.env.HOME || '', 'outlook-email-automation');
}

function pythonBin(root) {
  if (process.env.OUTLOOK_AUTOMATION_PYTHON) return process.env.OUTLOOK_AUTOMATION_PYTHON;
  const venv = path.join(root, '.venv', 'bin', 'python');
  if (fs.existsSync(venv)) return venv;
  return 'python3';
}

function enabled() {
  if (process.env.AGENTDEEZ_MAIL === '0') return false;
  const root = rootDir();
  return fs.existsSync(path.join(root, 'src', 'outlook_automation', '__main__.py'));
}

function call(args, timeoutMs) {
  const root = rootDir();
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(root), ['-m', 'outlook_automation', ...args], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: path.join(root, 'src') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`outlook_automation ${args[0]} timed out`));
    }, timeoutMs);
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err += b; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error((err || out || `exit ${code}`).trim().slice(0, 500)));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error(`outlook_automation ${args[0]} returned non-JSON`));
      }
    });
  });
}

function startSignup({ agent, platform, senderHint, useRelay }) {
  const args = ['signup', '--agent', agent || 'agentdeez', '--platform', platform];
  if (senderHint) args.push('--sender-hint', senderHint);
  if (useRelay) args.push('--relay');
  return call(args, 30000);
}

function waitForVerification(accountId, { timeout = 90, senderHint } = {}) {
  const args = ['wait-verification', String(accountId), '--timeout', String(timeout)];
  if (senderHint) args.push('--sender-hint', senderHint);
  return call(args, (timeout + 20) * 1000);
}

function credentials(accountId) {
  return call(['credentials', String(accountId)], 20000).then((acct) => {
    if (acct && acct.account_id == null && acct.id != null) acct.account_id = acct.id;
    return acct;
  });
}

function requestHuman(accountId, kind, instructions, url) {
  const args = ['request-human', String(accountId), '--kind', kind, '--instructions', instructions];
  if (url) args.push('--url', url);
  return call(args, 30000);
}

function handBrowser({ accountId, url, cdp, ws, wait }) {
  const waitS = Number(wait || process.env.AGENTDEEZ_CAPTCHA_WAIT || 300);
  const args = ['hand-browser', String(accountId), '--url', url, '--cdp', cdp, '--wait', String(waitS)];
  if (ws) args.push('--ws', ws);
  return call(args, (waitS + 40) * 1000);
}

function solveCaptcha({ accountId, url, screenshot, type, prompt, sitekey, width, height, wait }) {
  const waitS = Number(wait || process.env.AGENTDEEZ_CAPTCHA_WAIT || 240);
  const args = [
    'solve-captcha', String(accountId),
    '--url', url,
    '--screenshot', screenshot,
    '--type', type || 'hCaptcha',
    '--width', String(width || 0),
    '--height', String(height || 0),
    '--wait', String(waitS),
  ];
  if (prompt) args.push('--prompt', prompt);
  if (sitekey) args.push('--sitekey', sitekey);
  return call(args, (waitS + 40) * 1000);
}

module.exports = { enabled, rootDir, startSignup, waitForVerification, credentials, requestHuman, solveCaptcha, handBrowser };
