import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Transaction } from 'pluggy-sdk';
import { dateOnly, localDay, signedAmount, summarizeByCategory } from '../src/finance.js';

const tx = (over: Partial<Transaction>) => ({ type: 'DEBIT', amount: 10, category: 'Mercado', categoryId: '07010000', ...over }) as Transaction;

test('localDay converte UTC para o dia em São Paulo', () => {
  assert.equal(localDay('2026-10-02T02:30:00.000Z'), '2026-10-01');
  assert.equal(localDay('2026-10-02T15:00:00.000Z'), '2026-10-02');
});

test('dateOnly não desloca datas de vencimento à meia-noite UTC', () => {
  assert.equal(dateOnly('2026-11-14T00:00:00.000Z'), '2026-11-14');
  assert.equal(dateOnly(null), null);
});

test('signedAmount usa o tipo, não o sinal do valor', () => {
  assert.equal(signedAmount({ type: 'DEBIT', amount: 50 }), -50);
  assert.equal(signedAmount({ type: 'DEBIT', amount: -50 }), -50);
  assert.equal(signedAmount({ type: 'CREDIT', amount: -20 }), 20);
});

test('summarizeByCategory agrupa gastos e ignora movimentos internos', () => {
  const result = summarizeByCategory([
    tx({ amount: 30 }),
    tx({ amount: -10 }),
    tx({ amount: 60, category: 'Restaurante', categoryId: '08010000' }),
    tx({ amount: 999, category: 'Mesma titularidade', categoryId: '04000000' }),
    tx({ amount: 500, category: 'Pagamento de fatura', categoryId: '05100000' }),
    tx({ amount: 200, category: 'Aplicação', categoryId: '03010000' }),
    tx({ type: 'CREDIT', amount: 1000, category: 'Salário', categoryId: '01010000' }),
    tx({ amount: 5, category: null, categoryId: null }),
  ]);
  assert.equal(result.totalGastos, 105);
  assert.equal(result.totalEntradas, 1000);
  assert.deepEqual(
    result.categorias.map((c) => [c.categoria, c.total, c.quantidade]),
    [
      ['Restaurante', 60, 1],
      ['Mercado', 40, 2],
      ['Sem categoria', 5, 1],
    ],
  );
});
