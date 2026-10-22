import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { createOAuthProvider } from '../src/auth/provider.js';
import { createStore } from '../src/auth/store.js';
import { createTokenSigner } from '../src/auth/tokens.js';
import type { FinanceService } from '../src/pluggy.js';

const tempStore = () => createStore(mkdtempSync(join(tmpdir(), 'mypluggy-test-')));
const mcpUrl = new URL('https://mcp.example.com/mcp');

test('token assinado: válido, adulterado, tipo errado', () => {
  const signer = createTokenSigner('segredo');
  const { token } = signer.issue({ kind: 'access', clientId: 'c1', scopes: [] }, 60);
  assert.equal(signer.verify(token, 'access')?.clientId, 'c1');
  assert.equal(signer.verify(token, 'refresh'), null);
  assert.equal(signer.verify(`${token}x`, 'access'), null);
  assert.equal(createTokenSigner('outro').verify(token, 'access'), null);
  assert.equal(signer.verify(signer.issue({ kind: 'access', clientId: 'c1', scopes: [] }, -1).token, 'access'), null);
});

test('fluxo OAuth: autorizar → passkey ok → código → tokens → refresh', async () => {
  const store = tempStore();
  let pendingId = '';
  const oauth = createOAuthProvider(store, mcpUrl, (_res, view) => (pendingId = view.pendingId));
  const { provider } = oauth;
  const client = await provider.clientsStore.registerClient!({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Claude' });
  const params = { codeChallenge: 'desafio', redirectUri: 'https://claude.ai/api/mcp/auth_callback', state: 'xyz', resource: mcpUrl };

  await provider.authorize(client, params, {} as never);
  assert.ok(oauth.getPending(pendingId));

  const redirect = new URL(oauth.complete(pendingId)!);
  assert.equal(redirect.searchParams.get('state'), 'xyz');
  assert.equal(oauth.complete(pendingId), null, 'pendência é de uso único');

  const code = redirect.searchParams.get('code')!;
  assert.equal(await provider.challengeForAuthorizationCode(client, code), 'desafio');
  const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, params.redirectUri, mcpUrl);
  await assert.rejects(provider.exchangeAuthorizationCode(client, code), 'código é de uso único');

  const info = await provider.verifyAccessToken(tokens.access_token);
  assert.equal(info.clientId, client.client_id);
  assert.equal(info.resource?.href, mcpUrl.href);

  const refreshed = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
  assert.ok(await provider.verifyAccessToken(refreshed.access_token));
  await assert.rejects(provider.verifyAccessToken(tokens.refresh_token!), 'refresh não serve como access');
});

test('resource de outro servidor é recusado', async () => {
  const { provider } = createOAuthProvider(tempStore(), mcpUrl, () => {});
  const client = await provider.clientsStore.registerClient!({ redirect_uris: ['https://claude.ai/cb'] });
  await assert.rejects(provider.authorize(client, { codeChallenge: 'x', redirectUri: 'https://claude.ai/cb', resource: new URL('https://outro.com/mcp') }, {} as never));
});

test('HTTP: /mcp exige token e anuncia metadados OAuth', async () => {
  const app = createApp({ publicUrl: new URL('http://localhost'), setupToken: 'x'.repeat(24) }, tempStore(), {} as FinanceService);
  const server = app.listen(0);
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    const unauthorized = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get('www-authenticate') ?? '', /resource_metadata=".*oauth-protected-resource\/mcp"/);

    const resource = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.equal(resource.resource, 'http://localhost/mcp');

    const metadata = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
    assert.ok(metadata.registration_endpoint);
  } finally {
    server.close();
  }
});
