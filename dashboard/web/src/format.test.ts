import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consultaDaApi, fimDoDia, formatarBytes, formatarDuracao, inicioDoDia, primeiraLinha } from './format';

test('datas do filtro viram instantes ISO do dia local, inclusive no fim', () => {
  const inicio = new Date(inicioDoDia('2026-11-17'));
  const fim = new Date(fimDoDia('2026-11-17'));
  assert.equal(inicio.getHours(), 0);
  assert.equal(fim.getHours(), 23);
  assert.equal(fim.getTime() - inicio.getTime(), 86_400_000 - 1);
});

test('consultaDaApi converte datas e descarta vazios', () => {
  const q = consultaDaApi(new URLSearchParams('de=2026-11-01&ate=&status=502&pagina=2'));
  assert.equal(q.get('de'), inicioDoDia('2026-11-01'));
  assert.equal(q.has('ate'), false);
  assert.equal(q.get('status'), '502');
  assert.equal(q.get('pagina'), '2');
});

test('tamanhos, durações e primeira linha', () => {
  assert.equal(formatarBytes(512, 'en-US'), '512 B');
  assert.equal(formatarBytes(2048, 'en-US'), '2 KB');
  assert.equal(formatarBytes(1536 * 1024, 'pt-BR'), '1,5 MB');
  assert.equal(formatarBytes(null, 'en-US'), '—');
  assert.equal(formatarDuracao(850, 'en-US'), '850 ms');
  assert.equal(formatarDuracao(3200, 'pt-BR'), '3,2 s');
  assert.equal(primeiraLinha('a\nb'), 'a');
  assert.equal(primeiraLinha('x'.repeat(10), 4), 'xxxx…');
});
