import { createHmac, timingSafeEqual } from 'node:crypto';

export type TokenKind = 'access' | 'refresh';
export type TokenPayload = { kind: TokenKind; clientId: string; scopes: string[]; resource?: string; exp: number };

// Tokens assinados com HMAC: nada a guardar em disco e sobrevivem a reinício.
// Para revogar todos, apague `tokenSecret` de data/state.json e reinicie.
export function createTokenSigner(secret: string) {
  const sign = (body: string) => createHmac('sha256', secret).update(body).digest('base64url');

  return {
    issue(payload: Omit<TokenPayload, 'exp'>, ttlSeconds: number): { token: string; exp: number } {
      const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
      const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
      return { token: `${body}.${sign(body)}`, exp };
    },

    verify(token: string, kind: TokenKind): TokenPayload | null {
      const [body, signature, extra] = token.split('.');
      if (!body || !signature || extra !== undefined) return null;
      const expected = Buffer.from(sign(body));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
        if (payload.kind !== kind || payload.exp <= Math.floor(Date.now() / 1000)) return null;
        return payload;
      } catch {
        return null;
      }
    },
  };
}
