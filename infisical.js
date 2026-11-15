// Local self-hosted Infisical as the store for Discord creds and the session token.
// Reads come from env injected by `infisical run` (see run-agentdeez.sh). This module only writes the
// token back after a fresh login, using a Universal Auth machine identity or a short-lived access token.
const BASE = () => (process.env.INFISICAL_API_URL || 'http://localhost:8080').replace(/\/+$/, '').replace(/\/api$/, '');

function config() {
  const projectId = process.env.INFISICAL_PROJECT_ID;
  const clientId = process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID;
  const clientSecret = process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET;
  const token = process.env.INFISICAL_TOKEN;
  if (!projectId || !((clientId && clientSecret) || token)) return null;
  return {
    projectId,
    environment: process.env.INFISICAL_ENV || 'dev',
    secretPath: process.env.INFISICAL_SECRET_PATH || '/',
    tokenName: process.env.INFISICAL_TOKEN_SECRET_NAME || 'DISCORD_TOKEN',
    clientId, clientSecret, token,
  };
}

const isConfigured = () => config() !== null;

async function accessToken(cfg) {
  if (cfg.clientId && cfg.clientSecret) {
    const res = await fetch(`${BASE()}/api/v1/auth/universal-auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: cfg.clientId, clientSecret: cfg.clientSecret }),
    });
    if (!res.ok) throw new Error(`Infisical login failed: HTTP ${res.status}`);
    return (await res.json()).accessToken;
  }
  return cfg.token;
}

// Update the secret, creating it if it does not exist yet. Never logs the value.
async function writeSecret(name, value) {
  const cfg = config();
  if (!cfg) throw new Error('Infisical not configured');
  const auth = await accessToken(cfg);
  const url = `${BASE()}/api/v3/secrets/raw/${encodeURIComponent(name)}`;
  const body = JSON.stringify({ workspaceId: cfg.projectId, environment: cfg.environment, secretPath: cfg.secretPath, secretValue: value, type: 'shared' });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` };
  let res = await fetch(url, { method: 'PATCH', headers, body });
  if (res.status === 404 || res.status === 400) res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`Infisical write ${name} failed: HTTP ${res.status}`);
}

const saveToken = token => writeSecret(config().tokenName, token);

module.exports = { isConfigured, saveToken, writeSecret };
