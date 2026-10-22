import type { Account, CreditCardBills, Investment, Transaction } from 'pluggy-sdk';

const TIME_ZONE = 'America/Sao_Paulo';

// Categorias do Pluggy que movimentam dinheiro do próprio usuário e não são gasto:
// 03 = investimentos, 04 = transferência de mesma titularidade, 05100000 = pagamento de fatura.
const INTERNAL_CATEGORY_PREFIXES = ['03', '04', '05100000'];

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });

/** Data/hora da transação (UTC) → dia local no Brasil, YYYY-MM-DD. */
export function localDay(date: Date | string): string {
  return dayFormatter.format(new Date(date));
}

/** Datas de fatura/vencimento vêm como meia-noite UTC: só cortar, converter voltaria um dia. */
export function dateOnly(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  return new Date(date).toISOString().slice(0, 10);
}

export function isInternal(categoryId: string | null): boolean {
  return !!categoryId && INTERNAL_CATEGORY_PREFIXES.some((prefix) => categoryId.startsWith(prefix));
}

/** DEBIT = saída (negativo), CREDIT = entrada (positivo). O sinal do `amount` varia entre conta e cartão. */
export function signedAmount(tx: Pick<Transaction, 'type' | 'amount'>): number {
  const value = Math.abs(tx.amount);
  return tx.type === 'DEBIT' ? -value : value;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function toAccount(account: Account) {
  const credit = account.creditData;
  return {
    id: account.id,
    nome: account.marketingName ?? account.name,
    tipo: account.type === 'CREDIT' ? 'cartao_credito' : 'conta',
    subtipo: account.subtype,
    moeda: account.currencyCode,
    saldo: account.balance,
    ...(credit && {
      cartao: {
        observacao: 'saldo = valor usado do limite (inclui parcelas futuras), não é a fatura atual',
        limite: credit.availableCreditLimit != null ? round(account.balance + credit.availableCreditLimit) : credit.creditLimit,
        limiteDisponivel: credit.availableCreditLimit,
        bandeira: credit.brand,
        fechamentoFaturaAtual: dateOnly(credit.balanceCloseDate),
        vencimentoFaturaAtual: dateOnly(credit.balanceDueDate),
        pagamentoMinimo: credit.minimumPayment,
      },
    }),
  };
}

export function toTransaction(tx: Transaction, accountName: string) {
  const card = tx.creditCardMetadata;
  return {
    id: tx.id,
    data: localDay(tx.date),
    descricao: tx.description,
    valor: signedAmount(tx),
    moeda: tx.currencyCode,
    categoria: tx.category,
    conta: accountName,
    status: tx.status ?? null,
    ...(card?.totalInstallments && card.totalInstallments > 1 && {
      parcela: `${card.installmentNumber ?? '?'}/${card.totalInstallments}`,
    }),
  };
}

export function summarizeByCategory(transactions: Transaction[]) {
  const groups = new Map<string, { total: number; quantidade: number }>();
  let gastos = 0;
  let entradas = 0;
  for (const tx of transactions) {
    if (isInternal(tx.categoryId)) continue;
    const value = Math.abs(tx.amount);
    if (tx.type === 'CREDIT') {
      entradas += value;
      continue;
    }
    gastos += value;
    const name = tx.category ?? 'Sem categoria';
    const group = groups.get(name) ?? { total: 0, quantidade: 0 };
    group.total += value;
    group.quantidade += 1;
    groups.set(name, group);
  }
  const categorias = [...groups]
    .map(([categoria, g]) => ({
      categoria,
      total: round(g.total),
      quantidade: g.quantidade,
      percentual: gastos ? round((g.total / gastos) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);
  return { totalGastos: round(gastos), totalEntradas: round(entradas), categorias };
}

export function toBill(bill: CreditCardBills) {
  return {
    vencimento: dateOnly(bill.dueDate),
    fechamento: dateOnly(bill.billClosingDate),
    total: bill.totalAmount,
    moeda: bill.totalAmountCurrencyCode,
    pagamentoMinimo: bill.minimumPaymentAmount,
    pago: round((bill.payments ?? []).reduce((sum, p) => sum + Math.abs(p.amount), 0)),
  };
}

export function toInvestment(inv: Investment) {
  return {
    nome: inv.name,
    tipo: inv.type,
    subtipo: inv.subtype,
    moeda: inv.currencyCode,
    saldo: inv.balance,
    valorAplicado: inv.amountOriginal,
    rendimento: inv.amountProfit,
    taxaAnual: inv.annualRate,
    rentabilidade12Meses: inv.lastTwelveMonthsRate,
    vencimento: dateOnly(inv.dueDate),
    emissor: inv.issuer,
    status: inv.status,
  };
}
