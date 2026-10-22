// Logs só com metadados (rota, status, duração, nome da tool). Nunca corpo, query string, token ou dado bancário.
function errorSummary(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 200);
  return 'erro desconhecido';
}

export const log = {
  info: (message: string) => console.log(`${new Date().toISOString()} ${message}`),
  error: (message: string, err?: unknown) =>
    console.error(`${new Date().toISOString()} ${message}${err === undefined ? '' : ` — ${errorSummary(err)}`}`),
};
