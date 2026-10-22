import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

export type StoredPasskey = { id: string; publicKey: string; counter: number; transports: string[]; createdAt: string };

type State = {
  tokenSecret: string;
  clients: Record<string, OAuthClientInformationFull>;
  passkeys: StoredPasskey[];
};

const MAX_CLIENTS = 50;

// ponytail: um arquivo JSON basta para 1 usuário e 1 processo; trocar por SQLite se virar multiusuário.
export function createStore(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, 'state.json');
  let state: State;
  try {
    state = JSON.parse(readFileSync(file, 'utf8')) as State;
  } catch {
    state = { tokenSecret: '', clients: {}, passkeys: [] };
  }
  if (!state.tokenSecret) state.tokenSecret = randomBytes(32).toString('base64url');

  function save() {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  }
  save();

  return {
    tokenSecret: state.tokenSecret,

    getClient: (id: string) => state.clients[id],
    saveClient(client: OAuthClientInformationFull) {
      state.clients[client.client_id] = client;
      const ids = Object.keys(state.clients);
      // Registro dinâmico é público: mantém só os mais recentes para o arquivo não crescer sem limite.
      for (const old of ids.slice(0, Math.max(0, ids.length - MAX_CLIENTS))) delete state.clients[old];
      save();
    },

    listPasskeys: () => state.passkeys,
    findPasskey: (id: string) => state.passkeys.find((p) => p.id === id),
    addPasskey(passkey: StoredPasskey) {
      state.passkeys.push(passkey);
      save();
    },
    updateCounter(id: string, counter: number) {
      const passkey = state.passkeys.find((p) => p.id === id);
      if (passkey) passkey.counter = counter;
      save();
    },
  };
}

export type Store = ReturnType<typeof createStore>;
