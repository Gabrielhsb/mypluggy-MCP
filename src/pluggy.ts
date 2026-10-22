import { PluggyClient, type Account, type PageFilters, type PageResponse } from 'pluggy-sdk';
import type { Config } from './config.js';
import { summarizeByCategory, toAccount, toBill, toInvestment, toTransaction } from './finance.js';

const MAX_PAGES = 20;

async function allPages<T>(fetchPage: (filters: PageFilters) => Promise<PageResponse<T>>): Promise<T[]> {
  const results: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await fetchPage({ page, pageSize: 500 });
    results.push(...data.results);
    if (page >= data.totalPages) break;
  }
  return results;
}

export type Period = { de: string; ate: string; contaId?: string };

// O PluggyClient guarda o apiKey (JWT de 2h) e só autentica de novo quando ele expira.
export function createFinanceService(config: Config['pluggy'], client = new PluggyClient(config)) {
  async function accounts(contaId?: string): Promise<Account[]> {
    const perItem = await Promise.all(config.itemIds.map((itemId) => client.fetchAccounts(itemId).then((r) => r.results)));
    const all = perItem.flat();
    if (!contaId) return all;
    const match = all.filter((a) => a.id === contaId);
    if (!match.length) throw new Error(`Conta não encontrada: ${contaId}. Use listar_contas para ver os ids.`);
    return match;
  }

  async function transactions({ de, ate, contaId }: Period) {
    const list = await accounts(contaId);
    const perAccount = await Promise.all(
      list.map(async (account) => {
        const txs = await client.fetchAllTransactions(account.id, { dateFrom: de, dateTo: ate });
        return txs.map((tx) => ({ tx, accountName: account.marketingName ?? account.name }));
      }),
    );
    return perAccount.flat();
  }

  return {
    async listarContas() {
      return (await accounts()).map(toAccount);
    },

    async listarTransacoes(period: Period, limite: number) {
      const all = (await transactions(period))
        .map(({ tx, accountName }) => toTransaction(tx, accountName))
        .sort((a, b) => b.data.localeCompare(a.data));
      return { periodo: { de: period.de, ate: period.ate }, total: all.length, exibidas: Math.min(limite, all.length), transacoes: all.slice(0, limite) };
    },

    async resumoPorCategoria(period: Period) {
      const txs = (await transactions(period)).map(({ tx }) => tx);
      return {
        periodo: { de: period.de, ate: period.ate },
        observacao: 'Ignora transferências entre contas próprias, pagamento de fatura e aplicações/resgates.',
        ...summarizeByCategory(txs),
      };
    },

    async listarFaturasCartao(contaId?: string, quantidade = 6) {
      const cards = (await accounts(contaId)).filter((a) => a.type === 'CREDIT');
      return Promise.all(
        cards.map(async (card) => {
          const bills = await allPages((f) => client.fetchCreditCardBills(card.id, f));
          const fechadas = bills.map(toBill).sort((a, b) => (b.vencimento ?? '').localeCompare(a.vencimento ?? ''));
          const { cartao } = toAccount(card);
          return {
            cartao: card.marketingName ?? card.name,
            contaId: card.id,
            faturaAberta: {
              fechamento: cartao?.fechamentoFaturaAtual ?? null,
              vencimento: cartao?.vencimentoFaturaAtual ?? null,
              pagamentoMinimo: cartao?.pagamentoMinimo ?? null,
              observacao: 'O Pluggy não entrega o valor da fatura aberta; some as transações do cartão desde o último fechamento.',
            },
            faturasFechadas: fechadas.slice(0, quantidade),
          };
        }),
      );
    },

    async listarInvestimentos() {
      // Banco sem produto de investimento responde erro; vale como "nenhum investimento" naquele item.
      const perItem = await Promise.all(
        config.itemIds.map((itemId) => allPages((f) => client.fetchInvestments(itemId, undefined, f)).catch(() => [])),
      );
      return perItem.flat().map(toInvestment);
    },
  };
}

export type FinanceService = ReturnType<typeof createFinanceService>;
