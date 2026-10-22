import { createApp } from './app.js';
import { createStore } from './auth/store.js';
import { loadConfig } from './config.js';
import { log } from './log.js';
import { createFinanceService } from './pluggy.js';

const config = loadConfig();
const app = createApp(config, createStore(config.dataDir), createFinanceService(config.pluggy));

const server = app.listen(config.port, () => {
  log.info(`myPluggy MCP ouvindo na porta ${config.port} — endpoint ${new URL('/mcp', config.publicUrl).href}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
