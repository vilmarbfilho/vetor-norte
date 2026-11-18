// Route tests with a fake service (no browser, no portal access).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InjectOptions } from 'fastify';
import { ErroEntrega, type Destino, type Documento, type PedidoEnvio } from '../delivery/types.ts';
import { AuditoriaFake } from '../tests/audit-fakes.ts';
import { CHAVE_TOTAL, RepositorioChavesFake } from '../tests/auth-fakes.ts';
import { protocoloFake } from '../tests/fixtures.ts';
import { aplicarFiltros } from '../services/filters.ts';
import { ErroCredenciais } from '../scraper/sessions.ts';
import type { ServicoProtocolos } from '../services/protocols.ts';
import { criarApp } from './app.ts';

let chamadasAoPortal = 0;
const usuariosRecebidos: string[] = [];
/** Simulates the session manager: these key owners have missing / refused portal credentials. */
function verificarCredenciais(usuarioId: string) {
  usuariosRecebidos.push(usuarioId);
  if (usuarioId === 'usuario-sem-credenciais') throw new ErroCredenciais('credenciais_nao_cadastradas');
  if (usuarioId === 'usuario-credencial-invalida') throw new ErroCredenciais('credenciais_invalidas');
}
const servicoFake: ServicoProtocolos = {
  async listarPorCpf(usuarioId, cpf, filtros) {
    verificarCredenciais(usuarioId);
    chamadasAoPortal++;
    if (cpf.replace(/\D/g, '') === '11144477735') throw new Error('portal fora do ar');
    return aplicarFiltros(
      [protocoloFake({ protocolo: '10' }), protocoloFake({ protocolo: '11', pdfUrl: null, seguradora: 'Tokio' })],
      filtros,
    );
  },
  async obterPdf(usuarioId, numero) {
    verificarCredenciais(usuarioId);
    chamadasAoPortal++;
    if (numero === '10') return { tipo: 'ok', protocolo: protocoloFake({ protocolo: '10' }), pdf: Buffer.from('%PDF-1.7 fake') };
    if (numero === '11') return { tipo: 'sem_pdf', protocolo: protocoloFake({ protocolo: '11' }) };
    if (numero === '99') throw new Error('portal fora do ar ao buscar txtCpfSegurado=529.982.247-25');
    return { tipo: 'nao_encontrado' };
  },
  status: () => ({ sessoesAbertas: 0, maximo: 5 }),
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
const auditoria = new AuditoriaFake();
const CHAVE_SEM_CREDENCIAIS = 'vn_teste_sem_credenciais';
const CHAVE_CREDENCIAL_INVALIDA = 'vn_teste_credencial_invalida';
const app = criarApp(servicoFake, {
  auditoria,
  destinos: new Map([
    ['teste', destinoFake],
    ['quebrado', destinoQuebrado],
  ]),
  autenticacao: {
    repositorio: new RepositorioChavesFake()
      .adicionar(CHAVE_TOTAL, { id: 'total' })
      .adicionar(CHAVE_SEM_CREDENCIAIS, { id: 'sem', usuarioId: 'usuario-sem-credenciais' })
      .adicionar(CHAVE_CREDENCIAL_INVALIDA, { id: 'invalida', usuarioId: 'usuario-credencial-invalida' }),
    rateLimit: { habilitado: false, porMinutoPadrao: 60 },
  },
});

// Authentication itself is covered in auth.test.ts; here every call carries a key with all permissions.
const requisitar = (o: string | InjectOptions) =>
  app.inject({ ...(typeof o === 'string' ? { url: o } : o), headers: { 'x-api-key': CHAVE_TOTAL } });

test('CPF inválido -> 400 sem consultar o portal', async () => {
  const antes = chamadasAoPortal;
  const r = await requisitar('/protocolos?cpf=014.623.936-85');
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json(), { erro: 'CPF inválido' });
  assert.equal(chamadasAoPortal, antes);
});

test('sem CPF ou com parâmetro desconhecido -> 400', async () => {
  assert.equal((await requisitar('/protocolos')).statusCode, 400);
  assert.equal((await requisitar('/protocolos?cpf=52998224725&xpto=1')).statusCode, 400);
  assert.equal((await requisitar('/protocolos?cpf=52998224725&dataProtocoloDe=ontem')).statusCode, 400);
});

test('listagem retorna protocolos sem expor a URL interna', async () => {
  const r = await requisitar('/protocolos?cpf=52998224725');
  assert.equal(r.statusCode, 200);
  const corpo = r.json();
  assert.equal(corpo.cpf, '529.982.247-25');
  assert.equal(corpo.total, 2);
  assert.equal(corpo.protocolos[0].pdf, '/protocolos/10/pdf');
  assert.equal(corpo.protocolos[1].possuiPdf, false);
  assert.ok(!('pdfUrl' in corpo.protocolos[0]) && !('idInterno' in corpo.protocolos[0]));
});

test('listagem usa o prefixo público nos links de PDF', async () => {
  const comPrefixo = criarApp(servicoFake, {
    auditoria: new AuditoriaFake(),
    autenticacao: {
      repositorio: new RepositorioChavesFake().adicionar(CHAVE_TOTAL, { id: 'total' }),
      rateLimit: { habilitado: false, porMinutoPadrao: 60 },
    },
    prefixoPublico: '/broker',
  });
  const r = await comPrefixo.inject({ url: '/protocolos?cpf=52998224725', headers: { 'x-api-key': CHAVE_TOTAL } });
  assert.equal(r.json().protocolos[0].pdf, '/broker/protocolos/10/pdf');
});

test('listagem aplica filtros', async () => {
  const r = await requisitar('/protocolos?cpf=529.982.247-25&seguradora=tokio');
  assert.deepEqual(r.json().protocolos.map((p: { protocolo: string }) => p.protocolo), ['11']);
});

test('PDF: ok, sem PDF, não encontrado, inválido e falha do portal', async () => {
  const ok = await requisitar('/protocolos/10/pdf');
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['content-type'], 'application/pdf');
  assert.match(String(ok.headers['content-disposition']), /proposta_10\.pdf/);
  assert.equal(ok.rawPayload.subarray(0, 4).toString(), '%PDF');

  assert.equal((await requisitar('/protocolos/11/pdf')).statusCode, 404);
  assert.equal((await requisitar('/protocolos/12/pdf')).statusCode, 404);
  assert.equal((await requisitar('/protocolos/abc/pdf')).statusCode, 400);
  assert.equal((await requisitar('/protocolos/99/pdf')).statusCode, 502);
});

test('PDF em base64 (JSON) e formato inválido', async () => {
  const r = await requisitar('/protocolos/10/pdf?formato=base64');
  assert.equal(r.statusCode, 200);
  const { protocolo, arquivo } = r.json();
  assert.equal(protocolo, '10');
  assert.equal(arquivo.nome, 'proposta_10.pdf');
  assert.equal(arquivo.mimeType, 'application/pdf');
  assert.equal(Buffer.from(arquivo.base64, 'base64').toString(), '%PDF-1.7 fake');

  assert.equal((await requisitar('/protocolos/10/pdf?formato=binario')).headers['content-type'], 'application/pdf');
  assert.equal((await requisitar('/protocolos/10/pdf?formato=zip')).statusCode, 400);
});

test('GET /destinos lista nomes e tipos', async () => {
  assert.deepEqual((await requisitar('/destinos')).json(), {
    destinos: [{ nome: 'teste', tipo: 'fake' }, { nome: 'quebrado', tipo: 'fake' }],
  });
});

test('envio: entrega o PDF ao destino com os dados do pedido', async () => {
  entregas.length = 0;
  const r = await requisitar({
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
  const r = await requisitar({ method: 'POST', url: '/protocolos/10/pdf/envios', payload: { destino: 'xpto' } });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json().destinosDisponiveis, ['teste', 'quebrado']);
  assert.equal(chamadasAoPortal, antes);
});

test('envio: validação, 404 e falhas', async () => {
  const post = (url: string, payload: object) => requisitar({ method: 'POST', url, payload });
  assert.equal((await post('/protocolos/10/pdf/envios', {})).statusCode, 400);
  assert.equal((await post('/protocolos/10/pdf/envios', { destino: 'teste', url: 'http://evil' })).statusCode, 400);
  assert.equal((await post('/protocolos/11/pdf/envios', { destino: 'teste' })).statusCode, 404);
  assert.equal((await post('/protocolos/12/pdf/envios', { destino: 'teste' })).statusCode, 404);
  assert.equal((await post('/protocolos/99/pdf/envios', { destino: 'teste' })).statusCode, 502);

  const quebrado = await post('/protocolos/10/pdf/envios', { destino: 'quebrado' });
  assert.equal(quebrado.statusCode, 502);
  assert.deepEqual(quebrado.json(), { erro: 'Falha ao entregar o PDF no destino', destino: 'quebrado' });
});

test('histórico: cada pedido de PDF é registrado com tipo, resultado e chave', async () => {
  auditoria.limpar();
  await requisitar('/protocolos/10/pdf');
  await requisitar('/protocolos/10/pdf?formato=base64');
  await requisitar('/protocolos/11/pdf');
  await requisitar('/protocolos/12/pdf');
  await requisitar('/protocolos/99/pdf');
  await requisitar({ method: 'POST', url: '/protocolos/10/pdf/envios', payload: { destino: 'teste' } });
  await requisitar({ method: 'POST', url: '/protocolos/10/pdf/envios', payload: { destino: 'quebrado' } });
  await requisitar({ method: 'POST', url: '/protocolos/10/pdf/envios', payload: { destino: 'xpto' } }); // not history
  await requisitar('/protocolos/abc/pdf'); // 400 before the handler: not history

  assert.deepEqual(
    auditoria.downloads.map((d) => [d.protocolo, d.tipo, d.destino, d.resultado, d.tamanhoBytes, d.apiKeyId]),
    [
      ['10', 'binario', null, 'ok', 13, 'total'],
      ['10', 'base64', null, 'ok', 13, 'total'],
      ['11', 'binario', null, 'sem_pdf', null, 'total'],
      ['12', 'binario', null, 'nao_encontrado', null, 'total'],
      ['99', 'binario', null, 'erro', null, 'total'],
      ['10', 'envio', 'teste', 'ok', 13, 'total'],
      ['10', 'envio', 'quebrado', 'erro', null, 'total'],
    ],
  );
  assert.ok(auditoria.downloads.every((d) => d.duracaoMs >= 0));
  assert.ok(auditoria.downloads.every((d) => d.usuarioId === 'usuario-teste'));
});

test('histórico de consultas: CPF, filtros, protocolos retornados, resultado e chave', async () => {
  auditoria.limpar();
  await requisitar('/protocolos?cpf=529.982.247-25');
  await requisitar('/protocolos?cpf=52998224725&seguradora=tokio');
  await requisitar('/protocolos?cpf=111.444.777-35'); // portal failure
  await requisitar('/protocolos?cpf=111.111.111-11'); // invalid CPF: 400, not history
  await requisitar('/protocolos?cpf=52998224725&xpto=1'); // invalid query: 400 before the handler

  assert.deepEqual(
    auditoria.consultas.map((c) => [c.cpf, c.filtros, c.resultado, c.protocolos, c.apiKeyId]),
    [
      ['529.982.247-25', {}, 'ok', ['10', '11'], 'total'],
      ['52998224725', { seguradora: 'tokio' }, 'ok', ['11'], 'total'],
      ['111.444.777-35', {}, 'erro', [], 'total'],
    ],
  );
  assert.ok(auditoria.consultas.every((c) => c.duracaoMs >= 0));
  assert.ok(auditoria.consultas.every((c) => c.usuarioId === 'usuario-teste'));
});

test('log de erro: só respostas 5xx, com rota modelo, chave e detalhes', async () => {
  auditoria.limpar();
  await requisitar('/protocolos?cpf=111.111.111-11'); // 400: not logged
  await requisitar('/protocolos/12/pdf'); // 404: not logged
  assert.equal(auditoria.erros.length, 0);

  await requisitar('/protocolos/99/pdf');
  await requisitar({ method: 'POST', url: '/protocolos/10/pdf/envios', payload: { destino: 'quebrado' } });
  assert.equal(auditoria.erros.length, 2);
  const [portal, entrega] = auditoria.erros;
  assert.equal(portal!.statusHttp, 502);
  assert.equal(portal!.rota, '/protocolos/:protocolo/pdf');
  assert.equal(portal!.metodo, 'GET');
  assert.equal(portal!.apiKeyId, 'total');
  assert.equal(portal!.usuarioId, 'usuario-teste');
  assert.match(portal!.mensagem, /portal fora do ar/);
  assert.ok(portal!.requestId);
  assert.equal(entrega!.detalhes!.destino, 'quebrado');
});

test('credenciais do portal: usa o dono da chave; ausentes/recusadas -> 409 sem log de erro nem histórico', async () => {
  usuariosRecebidos.length = 0;
  await requisitar('/protocolos?cpf=52998224725');
  assert.deepEqual(usuariosRecebidos, ['usuario-teste']);

  auditoria.limpar();
  const comChave = (chave: string, o: InjectOptions) => app.inject({ ...o, headers: { 'x-api-key': chave } });
  const casos = [
    [CHAVE_SEM_CREDENCIAIS, 'credenciais_nao_cadastradas'],
    [CHAVE_CREDENCIAL_INVALIDA, 'credenciais_invalidas'],
  ] as const;
  for (const [chave, codigo] of casos) {
    for (const o of [
      { url: '/protocolos?cpf=52998224725' },
      { url: '/protocolos/10/pdf' },
      { method: 'POST' as const, url: '/protocolos/10/pdf/envios', payload: { destino: 'teste' } },
    ]) {
      const r = await comChave(chave, o);
      assert.equal(r.statusCode, 409, o.url);
      assert.equal(r.json().codigo, codigo);
      assert.match(r.json().erro, /dashboard/);
    }
  }
  assert.equal(auditoria.erros.length, 0);
  assert.equal(auditoria.downloads.length, 0);
  assert.equal(auditoria.consultas.length, 0);
});
