import { timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import express, { Router, type Response } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { log } from '../log.js';
import type { OAuth } from './provider.js';
import type { Store } from './store.js';

const MAX_TOKEN_FAILS = 5;
const TOKEN_WINDOW_MS = 15 * 60 * 1000;
const USER_ID = new TextEncoder().encode('mypluggy-mcp-owner');

const require = createRequire(import.meta.url);
const browserBundle = join(dirname(require.resolve('@simplewebauthn/browser')), '../dist/bundle/index.umd.min.js');

function safeEqual(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// A lib lança erro em resposta malformada ou assinatura inválida: tratamos como falha de verificação.
async function verifySafely<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export function createPasskeyRouter(store: Store, oauth: OAuth, publicUrl: URL, setupToken: string): Router {
  const router = Router();
  const rpID = publicUrl.hostname;
  const origin = publicUrl.origin;
  const tokenFails: number[] = [];

  router.get('/webauthn.js', (_req, res) => res.sendFile(browserBundle));
  router.use(express.json({ limit: '32kb' }));

  function pendingOr400(pendingId: unknown, res: Response) {
    const entry = typeof pendingId === 'string' ? oauth.getPending(pendingId) : undefined;
    if (!entry) res.status(400).json({ error: 'Autorização expirada. Volte ao claude.ai e conecte de novo.' });
    return entry;
  }

  function checkSetupToken(given: unknown, res: Response): boolean {
    const now = Date.now();
    while (tokenFails.length && tokenFails[0]! < now - TOKEN_WINDOW_MS) tokenFails.shift();
    if (tokenFails.length >= MAX_TOKEN_FAILS) {
      res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
      return false;
    }
    if (!safeEqual(given, setupToken)) {
      tokenFails.push(now);
      log.info('passkey: SETUP_TOKEN inválido');
      res.status(403).json({ error: 'SETUP_TOKEN inválido' });
      return false;
    }
    return true;
  }

  router.post('/passkey/register/options', async (req, res) => {
    const entry = pendingOr400(req.body?.pendingId, res);
    if (!entry || !checkSetupToken(req.body?.setupToken, res)) return;
    const options = await generateRegistrationOptions({
      rpName: 'myPluggy MCP',
      rpID,
      userName: 'owner',
      userID: USER_ID,
      attestationType: 'none',
      excludeCredentials: store.listPasskeys().map((p) => ({ id: p.id, transports: p.transports as AuthenticatorTransportFuture[] })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    entry.challenge = options.challenge;
    res.json(options);
  });

  router.post('/passkey/register/verify', async (req, res) => {
    const entry = pendingOr400(req.body?.pendingId, res);
    if (!entry || !checkSetupToken(req.body?.setupToken, res)) return;
    const expectedChallenge = entry.challenge;
    entry.challenge = undefined;
    const result = expectedChallenge
      ? await verifySafely(() =>
          verifyRegistrationResponse({ response: req.body.response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true }),
        )
      : null;
    if (!result?.verified) return void res.status(401).json({ error: 'Não foi possível validar a passkey' });

    const { id, publicKey, counter, transports } = result.registrationInfo.credential;
    store.addPasskey({ id, publicKey: Buffer.from(publicKey).toString('base64url'), counter, transports: transports ?? [], createdAt: new Date().toISOString() });
    log.info('passkey: nova passkey registrada');
    res.json({ redirect: oauth.complete(req.body.pendingId) });
  });

  router.post('/passkey/login/options', async (req, res) => {
    const entry = pendingOr400(req.body?.pendingId, res);
    if (!entry) return;
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
    entry.challenge = options.challenge;
    res.json(options);
  });

  router.post('/passkey/login/verify', async (req, res) => {
    const entry = pendingOr400(req.body?.pendingId, res);
    if (!entry) return;
    const expectedChallenge = entry.challenge;
    entry.challenge = undefined;
    const passkey = store.findPasskey(String(req.body?.response?.id ?? ''));
    const result =
      expectedChallenge && passkey
        ? await verifySafely(() =>
            verifyAuthenticationResponse({
              response: req.body.response,
              expectedChallenge,
              expectedOrigin: origin,
              expectedRPID: rpID,
              requireUserVerification: true,
              credential: {
                id: passkey.id,
                publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
                counter: passkey.counter,
                transports: passkey.transports as AuthenticatorTransportFuture[],
              },
            }),
          )
        : null;
    if (!result?.verified || !passkey) return void res.status(401).json({ error: 'Passkey não reconhecida' });

    store.updateCounter(passkey.id, result.authenticationInfo.newCounter);
    log.info('passkey: login ok');
    res.json({ redirect: oauth.complete(req.body.pendingId) });
  });

  return router;
}
