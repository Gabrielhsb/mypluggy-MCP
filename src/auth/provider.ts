import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidGrantError, InvalidRequestError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Store } from './store.js';
import { createTokenSigner } from './tokens.js';

const PENDING_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;

type Pending = { clientId: string; clientName: string; params: AuthorizationParams; expiresAt: number; challenge?: string };
type Code = { clientId: string; params: AuthorizationParams; expiresAt: number };

export type RenderAuthorizePage = (res: Response, view: { pendingId: string; clientName: string; hasPasskey: boolean }) => void;

function purge<T extends { expiresAt: number }>(map: Map<string, T>) {
  const now = Date.now();
  for (const [key, value] of map) if (value.expiresAt < now) map.delete(key);
}

function takeValid<T extends { expiresAt: number }>(map: Map<string, T>, key: string): T | undefined {
  const value = map.get(key);
  map.delete(key);
  return value && value.expiresAt > Date.now() ? value : undefined;
}

// ponytail: autorizações pendentes e códigos ficam em memória (vivem minutos); reinício só pede para conectar de novo.
export function createOAuthProvider(store: Store, mcpUrl: URL, render: RenderAuthorizePage) {
  const pending = new Map<string, Pending>();
  const codes = new Map<string, Code>();
  const signer = createTokenSigner(store.tokenSecret);
  const resource = mcpUrl.href;

  function checkResource(requested?: URL) {
    if (requested && requested.href.replace(/\/$/, '') !== resource.replace(/\/$/, '')) {
      throw new InvalidRequestError(`resource inválido; use ${resource}`);
    }
  }

  function issueTokens(clientId: string, scopes: string[]): OAuthTokens {
    const access = signer.issue({ kind: 'access', clientId, scopes, resource }, ACCESS_TTL_S);
    const refresh = signer.issue({ kind: 'refresh', clientId, scopes, resource }, REFRESH_TTL_S);
    return {
      access_token: access.token,
      token_type: 'bearer',
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh.token,
      ...(scopes.length && { scope: scopes.join(' ') }),
    };
  }

  const provider: OAuthServerProvider = {
    clientsStore: {
      getClient: (id) => store.getClient(id),
      registerClient(client) {
        const full: OAuthClientInformationFull = {
          ...client,
          client_id: randomBytes(16).toString('base64url'),
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };
        store.saveClient(full);
        return full;
      },
    },

    async authorize(client, params, res) {
      checkResource(params.resource);
      purge(pending);
      const pendingId = randomBytes(24).toString('base64url');
      const clientName = client.client_name ?? 'Cliente MCP';
      pending.set(pendingId, { clientId: client.client_id, clientName, params, expiresAt: Date.now() + PENDING_TTL_MS });
      render(res, { pendingId, clientName, hasPasskey: store.listPasskeys().length > 0 });
    },

    async challengeForAuthorizationCode(client, code) {
      const entry = codes.get(code);
      if (!entry || entry.clientId !== client.client_id) throw new InvalidGrantError('Código inválido');
      return entry.params.codeChallenge;
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, requestedResource) {
      const entry = takeValid(codes, code);
      if (!entry || entry.clientId !== client.client_id) throw new InvalidGrantError('Código inválido ou expirado');
      if (redirectUri && redirectUri !== entry.params.redirectUri) throw new InvalidGrantError('redirect_uri diferente');
      checkResource(requestedResource);
      return issueTokens(client.client_id, entry.params.scopes ?? []);
    },

    async exchangeRefreshToken(client, refreshToken, scopes, requestedResource) {
      const payload = signer.verify(refreshToken, 'refresh');
      if (!payload || payload.clientId !== client.client_id) throw new InvalidGrantError('Refresh token inválido');
      checkResource(requestedResource);
      const granted = scopes?.length ? scopes.filter((s) => payload.scopes.includes(s)) : payload.scopes;
      return issueTokens(client.client_id, granted);
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      const payload = signer.verify(token, 'access');
      if (!payload) throw new InvalidTokenError('Token inválido ou expirado');
      return {
        token,
        clientId: payload.clientId,
        scopes: payload.scopes,
        expiresAt: payload.exp,
        resource: payload.resource ? new URL(payload.resource) : undefined,
      };
    },
  };

  return {
    provider,

    /** Autorização pendente ainda válida (a página de login referencia só o id). */
    getPending(pendingId: string): Pending | undefined {
      const entry = pending.get(pendingId);
      return entry && entry.expiresAt > Date.now() ? entry : undefined;
    },

    /** Passkey verificada: troca a autorização pendente por um código e devolve a URL de retorno do cliente. */
    complete(pendingId: string): string | null {
      const entry = takeValid(pending, pendingId);
      if (!entry) return null;
      purge(codes);
      const code = randomBytes(32).toString('base64url');
      codes.set(code, { clientId: entry.clientId, params: entry.params, expiresAt: Date.now() + CODE_TTL_MS });
      const url = new URL(entry.params.redirectUri);
      url.searchParams.set('code', code);
      if (entry.params.state) url.searchParams.set('state', entry.params.state);
      return url.href;
    },
  };
}

export type OAuth = ReturnType<typeof createOAuthProvider>;
