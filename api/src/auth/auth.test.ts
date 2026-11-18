// API key authentication, permissions and rate limit (no database, no browser).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarApp } from '../api/app.ts';
import type { ServicoProtocolos } from '../services/protocols.ts';
import { AuditoriaFake } from '../tests/audit-fakes.ts';
import { RepositorioChavesFake } from '../tests/auth-fakes.ts';
import { protocoloFake } from '../tests/fixtures.ts';
import { chaveDosCabecalhos, gerarChave, hashDaChave, prefixoDaChave } from './keys.ts';
import { LimitadorPorMinuto } from './rate-limit.ts';

let chamadasAoPortal = 0;
const servico: ServicoProtocolos = {
  async listarPorCpf() {
    chamadasAoPortal++;
    return [protocoloFake()];
  },
  async obterPdf() {
    chamadasAoPortal++;
    return { tipo: 'ok', protocolo: protocoloFake(), pdf: Buffer.from('%PDF-1.7') };
  },
  status: () => ({ ativa: true }),
};

const LISTAGEM = '/protocolos?cpf=52998224725';
const SO_LISTA = 'vn_so_lista';
const LIMITADA = 'vn_limitada';

function montar(opcoes: { rateLimit?: boolean; agora?: () => number } = {}) {
  const repositorio = new RepositorioChavesFake()
    .adicionar(SO_LISTA, { id: 'so-lista', permissoes: ['protocolos:listar'] })
    .adicionar(LIMITADA, { id: 'limitada', limitePorMinuto: 2 });
  const auditoria = new AuditoriaFake();
  const app = criarApp(servico, {
    autenticacao: {
      repositorio,
      rateLimit: { habilitado: opcoes.rateLimit ?? false, porMinutoPadrao: 3 },
      limitador: new LimitadorPorMinuto(opcoes.agora),
    },
    auditoria,
  });
  const get = (url: string, chave?: string) =>
    app.inject({ url, headers: chave ? { authorization: `Bearer ${chave}` } : {} });
  return { app, repositorio, auditoria, get };
}

test('gerarChave: formato, prefixo e hash', () => {
  const { chave, prefixo, hash } = gerarChave();
  assert.match(chave, /^vn_[A-Za-z0-9_-]{43}$/);
  assert.equal(prefixo, chave.slice(0, 11));
  assert.equal(prefixo, prefixoDaChave(chave));
  assert.equal(hash, hashDaChave(chave));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(gerarChave().chave, chave);
});

test('chaveDosCabecalhos: Bearer e X-API-Key', () => {
  assert.equal(chaveDosCabecalhos({ authorization: 'Bearer vn_abc' }), 'vn_abc');
  assert.equal(chaveDosCabecalhos({ authorization: 'bearer   vn_abc ' }), 'vn_abc');
  assert.equal(chaveDosCabecalhos({ 'x-api-key': ' vn_abc ' }), 'vn_abc');
  assert.equal(chaveDosCabecalhos({ authorization: 'Basic xyz' }), null);
  assert.equal(chaveDosCabecalhos({}), null);
});

test('/health é público', async () => {
  const { get } = montar();
  assert.equal((await get('/health')).statusCode, 200);
});

test('sem chave ou chave inválida -> 401 sem consultar o portal', async () => {
  const { get } = montar();
  const antes = chamadasAoPortal;
  const sem = await get(LISTAGEM);
  assert.equal(sem.statusCode, 401);
  assert.equal(sem.headers['www-authenticate'], 'Bearer');
  assert.equal((await get(LISTAGEM, 'vn_nao_existe')).statusCode, 401);
  assert.equal((await get('/destinos')).statusCode, 401);
  assert.equal((await get('/rota-inexistente')).statusCode, 401);
  assert.equal(chamadasAoPortal, antes);
});

test('chave sem a permissão da rota -> 403', async () => {
  const { get } = montar();
  assert.equal((await get(LISTAGEM, SO_LISTA)).statusCode, 200);
  const r = await get('/protocolos/10/pdf', SO_LISTA);
  assert.equal(r.statusCode, 403);
  assert.deepEqual(r.json(), { erro: 'API key sem permissão para esta operação', permissaoNecessaria: 'pdf:baixar' });
  assert.equal((await get('/destinos', SO_LISTA)).statusCode, 403);
});

test('chave válida registra uso; rota desconhecida com chave válida -> 404', async () => {
  const { get, repositorio } = montar();
  await get(LISTAGEM, SO_LISTA);
  assert.deepEqual(repositorio.usos, ['so-lista']);
  assert.equal((await get('/rota-inexistente', SO_LISTA)).statusCode, 404);
});

test('banco indisponível -> 503 (falha fechada)', async () => {
  const { get, repositorio, auditoria } = montar();
  repositorio.falhar = true;
  const r = await get(LISTAGEM, SO_LISTA);
  assert.equal(r.statusCode, 503);
  assert.equal(r.json().erro, 'Autenticação indisponível. Tente novamente.');
  // The failure also goes to the error log (best effort: the DB may still be down).
  assert.equal(auditoria.erros.length, 1);
  assert.equal(auditoria.erros[0]!.statusHttp, 503);
  assert.equal(auditoria.erros[0]!.mensagem, 'banco fora do ar');
});

test('rate limit: padrão global, limite próprio da chave, 429 e nova janela', async () => {
  let agora = 1_000_000;
  const { get } = montar({ rateLimit: true, agora: () => agora });

  // Key with its own limit (2/min).
  const r1 = await get(LISTAGEM, LIMITADA);
  assert.equal(r1.headers['x-ratelimit-limit'], '2');
  assert.equal(r1.headers['x-ratelimit-remaining'], '1');
  assert.equal((await get(LISTAGEM, LIMITADA)).statusCode, 200);
  const bloqueada = await get(LISTAGEM, LIMITADA);
  assert.equal(bloqueada.statusCode, 429);
  assert.equal(bloqueada.headers['retry-after'], '60');

  // Counters are per key: the other key uses the global default (3/min).
  for (let i = 0; i < 3; i++) assert.equal((await get(LISTAGEM, SO_LISTA)).statusCode, 200);
  assert.equal((await get(LISTAGEM, SO_LISTA)).statusCode, 429);

  // A new minute opens a new window.
  agora += 60_000;
  assert.equal((await get(LISTAGEM, LIMITADA)).statusCode, 200);
});

test('rate limit desabilitado: sem 429 e sem cabeçalhos', async () => {
  const { get } = montar({ rateLimit: false });
  for (let i = 0; i < 5; i++) {
    const r = await get(LISTAGEM, LIMITADA);
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['x-ratelimit-limit'], undefined);
  }
});
