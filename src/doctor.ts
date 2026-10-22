// Diagnóstico da conexão com o Pluggy: confere credenciais, itens e o formato das respostas.
// Imprime só contagens, status e nomes de campos — nenhum valor, nome de pessoa ou número de conta.
import { PluggyClient } from 'pluggy-sdk';
import { loadPluggyConfig } from './config.js';

const config = loadPluggyConfig();
const client = new PluggyClient(config);
const keys = (obj: object | null | undefined) => (obj ? Object.keys(obj).sort().join(', ') : '(vazio)');
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

let failures = 0;
console.log(`Itens configurados: ${config.itemIds.length}\n`);

for (const [index, itemId] of config.itemIds.entries()) {
  const label = `Item ${index + 1}`;
  try {
    const item = await client.fetchItem(itemId);
    console.log(`${label}: conector "${item.connector.name}", status ${item.status}, atualizado em ${item.lastUpdatedAt ? new Date(item.lastUpdatedAt).toISOString() : '?'}`);

    const accounts = (await client.fetchAccounts(itemId)).results;
    const byType = accounts.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.subtype]: (acc[a.subtype] ?? 0) + 1 }), {});
    console.log(`  contas: ${accounts.length} ${JSON.stringify(byType)}`);
    if (accounts[0]) console.log(`  campos da conta: ${keys(accounts[0])}`);

    for (const account of accounts) {
      const txs = await client.fetchAllTransactions(account.id, { dateFrom: daysAgo(30), dateTo: daysAgo(0) });
      console.log(`  ${account.subtype}: ${txs.length} transações nos últimos 30 dias`);
      if (txs[0]) console.log(`    campos da transação: ${keys(txs[0])}`);
      if (account.type === 'CREDIT') {
        const bills = (await client.fetchCreditCardBills(account.id)).results;
        console.log(`    faturas fechadas: ${bills.length}`);
        if (bills[0]) console.log(`    campos da fatura: ${keys(bills[0])}`);
      }
    }

    const investments = await client.fetchInvestments(itemId).catch((err: Error) => err);
    console.log(`  investimentos: ${investments instanceof Error ? `indisponível (${investments.message.slice(0, 80)})` : investments.total}`);
  } catch (err) {
    failures++;
    console.log(`${label}: FALHOU — ${err instanceof Error ? err.message.slice(0, 200) : 'erro desconhecido'}`);
  }
  console.log('');
}

console.log(failures ? `${failures} item(ns) com falha.` : 'Tudo certo: credenciais e itens acessíveis.');
process.exit(failures ? 1 : 0);
