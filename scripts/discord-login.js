// Easy Discord login for AgentDeez / CozyBrowsin agents.
//
// Automatic mode: put token in DISCORD_TOKEN env or %TEMP%/dtok.txt and just launch.
// Manual: paste this into DevTools console on discord.com and call login("token").

function login(token) {
  if (!token || typeof token !== 'string') {
    console.error('Provide a token string');
    return;
  }
  // Discord expects the token quoted in localStorage
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
  console.log('Token injection started; page will reload shortly.');
}

console.log('Discord login helper loaded. Call login("YOUR_TOKEN") to sign in.');
