import { randomBytes } from 'node:crypto';
import type { RenderAuthorizePage } from './provider.js';

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STYLE = `
  :root { color-scheme: light dark; --bg: #f5f6f8; --card: #fff; --text: #1d2330; --muted: #677085; --accent: #2f6fed; --error: #c62828; }
  @media (prefers-color-scheme: dark) { :root { --bg: #11141a; --card: #1b2029; --text: #e9ecf2; --muted: #9aa3b5; --accent: #6d9bff; --error: #ff7b7b; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  main { width: 100%; max-width: 380px; background: var(--card); border-radius: 16px; padding: 28px; box-shadow: 0 8px 30px rgb(0 0 0 / 0.08); }
  h1 { font-size: 1.25rem; margin: 0 0 8px; }
  p { color: var(--muted); margin: 0 0 20px; }
  input, button { width: 100%; font: inherit; padding: 12px 14px; border-radius: 10px; }
  input { border: 1px solid var(--muted); background: transparent; color: inherit; margin-bottom: 12px; }
  button { border: 0; background: var(--accent); color: #fff; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: wait; }
  #error { color: var(--error); min-height: 1.5em; margin: 12px 0 0; }
`;

const SCRIPT = `
  const { startRegistration, startAuthentication } = SimpleWebAuthnBrowser;
  const form = document.getElementById('form');
  const button = form.querySelector('button');
  const errorBox = document.getElementById('error');
  const pendingId = form.dataset.pending;
  const registering = form.dataset.mode === 'register';

  async function post(path, body) {
    const res = await fetch('/oauth/passkey/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha (' + res.status + ')');
    return data;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    errorBox.textContent = '';
    try {
      const flow = registering ? 'register' : 'login';
      const base = { pendingId, setupToken: registering ? form.setupToken.value : undefined };
      const options = await post(flow + '/options', base);
      const response = registering ? await startRegistration({ optionsJSON: options }) : await startAuthentication({ optionsJSON: options });
      const { redirect } = await post(flow + '/verify', { ...base, response });
      location.href = redirect;
    } catch (err) {
      errorBox.textContent = err.message;
      button.disabled = false;
    }
  });
`;

export const renderAuthorizePage: RenderAuthorizePage = (res, { pendingId, clientName, hasPasskey }) => {
  const nonce = randomBytes(16).toString('base64');
  const mode = hasPasskey ? 'login' : 'register';
  const body = hasPasskey
    ? `<h1>Autorizar acesso</h1>
       <p><strong>${escapeHtml(clientName)}</strong> quer ler seus dados financeiros (somente leitura). Confirme com sua passkey.</p>
       <button type="submit">Entrar com passkey</button>`
    : `<h1>Primeiro acesso</h1>
       <p>Nenhuma passkey cadastrada. Informe o <code>SETUP_TOKEN</code> do servidor para registrar a sua e autorizar <strong>${escapeHtml(clientName)}</strong>.</p>
       <input name="setupToken" type="password" placeholder="SETUP_TOKEN" autocomplete="off" required>
       <button type="submit">Registrar passkey</button>`;

  res
    .status(200)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
    })
    .send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autorizar acesso</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<main>
  <form id="form" data-pending="${pendingId}" data-mode="${mode}">${body}</form>
  <p id="error" role="alert"></p>
</main>
<script src="/oauth/webauthn.js"></script>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`);
};
