// Route tests with a fake service (no browser, no portal access).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protocoloFake } from '../tests/fixtures.ts';
import { aplicarFiltros } from '../services/filters.ts';
import type { ServicoProtocolos } from '../services/protocols.ts';
import { criarApp } from './app.ts';

let chamadasAoPortal = 0;
const servicoFake: ServicoProtocolos = {
  async listarPorCpf(_cpf, filtros) {
    chamadasAoPortal++;
    return aplicarFiltros(
      [protocoloFake({ protocolo: '10' }), protocoloFake({ protocolo: '11', pdfUrl: null, seguradora: 'Tokio' })],
      filtros,
    );
  },
  async obterPdf(numero) {
    chamadasAoPortal++;
    if (numero === '10') return { tipo: 'ok', protocolo: protocoloFake({ protocolo: '10' }), pdf: Buffer.from('%PDF-1.7 fake') };
    if (numero === '11') return { tipo: 'sem_pdf', protocolo: protocoloFake({ protocolo: '11' }) };
    if (numero === '99') throw new Error('portal fora do ar');
    return { tipo: 'nao_encontrado' };
  },
  status: () => ({ ativa: true }),
};
const app = criarApp(servicoFake);

test('CPF inválido -> 400 sem consultar o portal', async () => {
  const antes = chamadasAoPortal;
  const r = await app.inject('/protocolos?cpf=014.623.936-85');
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json(), { erro: 'CPF inválido' });
  assert.equal(chamadasAoPortal, antes);
});

test('sem CPF ou com parâmetro desconhecido -> 400', async () => {
  assert.equal((await app.inject('/protocolos')).statusCode, 400);
  assert.equal((await app.inject('/protocolos?cpf=52998224725&xpto=1')).statusCode, 400);
  assert.equal((await app.inject('/protocolos?cpf=52998224725&dataProtocoloDe=ontem')).statusCode, 400);
});

test('listagem retorna protocolos sem expor a URL interna', async () => {
  const r = await app.inject('/protocolos?cpf=52998224725');
  assert.equal(r.statusCode, 200);
  const corpo = r.json();
  assert.equal(corpo.cpf, '529.982.247-25');
  assert.equal(corpo.total, 2);
  assert.equal(corpo.protocolos[0].pdf, '/protocolos/10/pdf');
  assert.equal(corpo.protocolos[1].possuiPdf, false);
  assert.ok(!('pdfUrl' in corpo.protocolos[0]) && !('idInterno' in corpo.protocolos[0]));
});

test('listagem aplica filtros', async () => {
  const r = await app.inject('/protocolos?cpf=529.982.247-25&seguradora=tokio');
  assert.deepEqual(r.json().protocolos.map((p: { protocolo: string }) => p.protocolo), ['11']);
});

test('PDF: ok, sem PDF, não encontrado, inválido e falha do portal', async () => {
  const ok = await app.inject('/protocolos/10/pdf');
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['content-type'], 'application/pdf');
  assert.match(String(ok.headers['content-disposition']), /proposta_10\.pdf/);
  assert.equal(ok.rawPayload.subarray(0, 4).toString(), '%PDF');

  assert.equal((await app.inject('/protocolos/11/pdf')).statusCode, 404);
  assert.equal((await app.inject('/protocolos/12/pdf')).statusCode, 404);
  assert.equal((await app.inject('/protocolos/abc/pdf')).statusCode, 400);
  assert.equal((await app.inject('/protocolos/99/pdf')).statusCode, 502);
});
