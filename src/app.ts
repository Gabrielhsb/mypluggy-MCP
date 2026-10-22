import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { renderAuthorizePage } from './auth/page.js';
import { createPasskeyRouter } from './auth/passkey.js';
import { createOAuthProvider } from './auth/provider.js';
import type { Store } from './auth/store.js';
import type { Config } from './config.js';
import { log } from './log.js';
import type { FinanceService } from './pluggy.js';
import { createMcpServer } from './tools.js';

export function createApp(config: Pick<Config, 'publicUrl' | 'setupToken'>, store: Store, finance: FinanceService): Express {
  const mcpUrl = new URL('/mcp', config.publicUrl);
  const oauth = createOAuthProvider(store, mcpUrl, renderAuthorizePage);
  const app = express();

  // Atrás de 1 proxy reverso (Caddy/nginx): IP real vem do X-Forwarded-For, usado pelo rate limit.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const started = Date.now();
    const path = req.originalUrl.split('?')[0];
    res.on('finish', () => log.info(`${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`));
    next();
  });

  app.get('/health', (_req, res) => void res.json({ ok: true }));

  app.use(
    mcpAuthRouter({
      provider: oauth.provider,
      issuerUrl: config.publicUrl,
      resourceServerUrl: mcpUrl,
      resourceName: 'myPluggy MCP',
    }),
  );
  app.use('/oauth', rateLimit({ windowMs: 60_000, limit: 30 }), createPasskeyRouter(store, oauth, config.publicUrl, config.setupToken));

  app.post(
    '/mcp',
    rateLimit({ windowMs: 60_000, limit: 60 }),
    requireBearerAuth({
      verifier: oauth.provider,
      expectedResource: mcpUrl,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
    }),
    express.json({ limit: '1mb' }),
    async (req, res) => {
      // Modo stateless: servidor e transporte novos por requisição, nada a limpar entre chamadas.
      const server = createMcpServer(finance);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        log.error('mcp: erro ao processar requisição', err);
        if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erro interno' }, id: null });
      }
    },
  );

  app.all('/mcp', (_req, res) => {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Método não permitido' }, id: null });
  });

  return app;
}
