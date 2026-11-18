// Route tests with a fake service (no browser, no portal access).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ErroEntrega, type Destino, type Documento, type PedidoEnvio } from '../delivery/types.ts';
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
const entregas: { doc: Documento; pedido: PedidoEnvio }[] = [];
const destinoFake: Destino = {
  nome: 'teste',
  tipo: 'fake',
  async enviar(doc, pedido) {
    entregas.push({ doc, pedido });
    return { status: 200 };
  },
};
const destinoQuebrado: Destino = {
  nome: 'quebrado',
  tipo: 'fake',
  async enviar() {
    throw new ErroEntrega('quebrado', 'HTTP 500');
  },
};
const app = criarApp(servicoFake, {
  destinos: new Map([
    ['teste', destinoFake],
    ['quebrado', destinoQuebrado],
  ]),
});

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

test('PDF em base64 (JSON) e formato inválido', async () => {
  const r = await app.inject('/protocolos/10/pdf?formato=base64');
  assert.equal(r.statusCode, 200);
  const { protocolo, arquivo } = r.json();
  assert.equal(protocolo, '10');
  assert.equal(arquivo.nome, 'proposta_10.pdf');
  assert.equal(arquivo.mimeType, 'application/pdf');
  assert.equal(Buffer.from(arquivo.base64, 'base64').toString(), '%PDF-1.7 fake');

  assert.equal((await app.inject('/protocolos/10/pdf?formato=binario')).headers['content-type'], 'application/pdf');
  assert.equal((await app.inject('/protocolos/10/pdf?formato=zip')).statusCode, 400);
});

test('GET /destinos lista nomes e tipos', async () => {
  assert.deepEqual((await app.inject('/destinos')).json(), {
    destinos: [{ nome: 'teste', tipo: 'fake' }, { nome: 'quebrado', tipo: 'fake' }],
  });
});

test('envio: entrega o PDF ao destino com os dados do pedido', async () => {
  entregas.length = 0;
  const r = await app.inject({
    method: 'POST',
    url: '/protocolos/10/pdf/envios',
    payload: { destino: 'teste', destinatario: '5511999999999', mensagem: 'Olá', referencia: 'r1' },
  });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), {
    enviado: true, destino: 'teste', protocolo: '10',
    arquivo: { nome: 'proposta_10.pdf', tamanho: 13 }, referencia: 'r1',
  });
  assert.equal(entregas.length, 1);
  assert.equal(entregas[0]!.doc.conteudo.subarray(0, 4).toString(), '%PDF');
  assert.deepEqual(entregas[0]!.pedido, { destinatario: '5511999999999', mensagem: 'Olá', referencia: 'r1' });
});

test('envio: destino desconhecido -> 400 sem consultar o portal', async () => {
  const antes = chamadasAoPortal;
  const r = await app.inject({ method: 'POST', url: '/protocolos/10/pdf/envios', payload: { destino: 'xpto' } });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json().destinosDisponiveis, ['teste', 'quebrado']);
  assert.equal(chamadasAoPortal, antes);
});

test('envio: validação, 404 e falhas', async () => {
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
  assert.equal((await post('/protocolos/10/pdf/envios', {})).statusCode, 400);
  assert.equal((await post('/protocolos/10/pdf/envios', { destino: 'teste', url: 'http://evil' })).statusCode, 400);
  assert.equal((await post('/protocolos/11/pdf/envios', { destino: 'teste' })).statusCode, 404);
  assert.equal((await post('/protocolos/12/pdf/envios', { destino: 'teste' })).statusCode, 404);
  assert.equal((await post('/protocolos/99/pdf/envios', { destino: 'teste' })).statusCode, 502);

  const quebrado = await post('/protocolos/10/pdf/envios', { destino: 'quebrado' });
  assert.equal(quebrado.statusCode, 502);
  assert.deepEqual(quebrado.json(), { erro: 'Falha ao entregar o PDF no destino', destino: 'quebrado' });
});
