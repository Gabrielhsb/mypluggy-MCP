import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { log } from './log.js';
import type { FinanceService } from './pluggy.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD');
const period = {
  de: isoDate.describe('Data inicial (YYYY-MM-DD), inclusiva'),
  ate: isoDate.describe('Data final (YYYY-MM-DD), inclusiva'),
  conta_id: z.string().optional().describe('Id de uma conta (veja listar_contas). Sem ele, usa todas.'),
};
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

async function run(name: string, fn: () => Promise<unknown>) {
  const started = Date.now();
  try {
    const data = await fn();
    log.info(`tool ${name} ok ${Date.now() - started}ms`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
  } catch (err) {
    log.error(`tool ${name} falhou ${Date.now() - started}ms`, err);
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    return { isError: true, content: [{ type: 'text' as const, text: `Falha ao consultar o Pluggy: ${message}` }] };
  }
}

export function createMcpServer(finance: FinanceService): McpServer {
  const server = new McpServer({ name: 'mypluggy-mcp', version: '1.0.0' });

  server.registerTool(
    'listar_contas',
    {
      title: 'Listar contas',
      description: 'Contas bancárias e cartões de crédito conectados, com saldo atual, limite e datas da fatura.',
      annotations: readOnly,
    },
    () => run('listar_contas', () => finance.listarContas()),
  );

  server.registerTool(
    'listar_transacoes',
    {
      title: 'Listar transações',
      description: 'Transações no período, da mais recente para a mais antiga. Valor negativo = saída, positivo = entrada.',
      inputSchema: { ...period, limite: z.number().int().min(1).max(1000).default(200).describe('Máximo de transações retornadas') },
      annotations: readOnly,
    },
    ({ de, ate, conta_id, limite }) => run('listar_transacoes', () => finance.listarTransacoes({ de, ate, contaId: conta_id }, limite)),
  );

  server.registerTool(
    'resumo_por_categoria',
    {
      title: 'Resumo de gastos por categoria',
      description: 'Total de gastos agrupado por categoria no período, com percentual. Ignora transferências entre contas próprias e pagamento de fatura.',
      inputSchema: period,
      annotations: readOnly,
    },
    ({ de, ate, conta_id }) => run('resumo_por_categoria', () => finance.resumoPorCategoria({ de, ate, contaId: conta_id })),
  );

  server.registerTool(
    'listar_faturas_cartao',
    {
      title: 'Listar faturas de cartão',
      description: 'Fatura aberta (fechamento, vencimento, mínimo) e últimas faturas fechadas de cada cartão de crédito.',
      inputSchema: {
        conta_id: z.string().optional().describe('Id do cartão (veja listar_contas). Sem ele, usa todos.'),
        quantidade: z.number().int().min(1).max(24).default(6).describe('Quantas faturas fechadas retornar por cartão'),
      },
      annotations: readOnly,
    },
    ({ conta_id, quantidade }) => run('listar_faturas_cartao', () => finance.listarFaturasCartao(conta_id, quantidade)),
  );

  server.registerTool(
    'listar_investimentos',
    {
      title: 'Listar investimentos',
      description: 'Posição atual dos investimentos (saldo, valor aplicado, rendimento, taxa e vencimento), quando o banco disponibiliza.',
      annotations: readOnly,
    },
    () => run('listar_investimentos', () => finance.listarInvestimentos()),
  );

  return server;
}
