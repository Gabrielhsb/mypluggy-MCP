export type Config = {
  port: number;
  publicUrl: URL;
  dataDir: string;
  setupToken: string;
  pluggy: { clientId: string; clientSecret: string; itemIds: string[] };
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

export function loadPluggyConfig(env: NodeJS.ProcessEnv = process.env): Config['pluggy'] {
  const itemIds = required(env, 'PLUGGY_ITEM_IDS')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return {
    clientId: required(env, 'PLUGGY_CLIENT_ID'),
    clientSecret: required(env, 'PLUGGY_CLIENT_SECRET'),
    itemIds,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicUrl = new URL(required(env, 'PUBLIC_URL'));
  const setupToken = required(env, 'SETUP_TOKEN');
  if (setupToken.length < 24) throw new Error('SETUP_TOKEN precisa ter pelo menos 24 caracteres');
  return {
    port: Number(env.PORT ?? 3000),
    publicUrl,
    dataDir: env.DATA_DIR ?? './data',
    setupToken,
    pluggy: loadPluggyConfig(env),
  };
}
