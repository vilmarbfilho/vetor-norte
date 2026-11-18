// Dashboard HTTP API with in-memory repositories (no database).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InjectOptions } from 'fastify';
import { criarApp } from './app.ts';
import { hashSenha } from './auth/passwords.ts';
import { ChavesFake, ContasFake, MonitoramentoFake } from './tests/fakes.ts';

const SENHA = 'senha-de-teste-123';
const CSRF = { 'x-requested-with': 'vetornorte-dashboard' };

async function montar() {
  const contas = new ContasFake();
  contas.usuarios.push(
    { id: 'u1', nome: 'Ana', email: 'ana@exemplo.com', idioma: 'pt', senhaHash: await hashSenha(SENHA), ativo: true },
    { id: 'u2', nome: 'Inativo', email: 'inativo@exemplo.com', idioma: 'pt', senhaHash: await hashSenha(SENHA), ativo: false },
  );
  const monitoramento = new MonitoramentoFake();
  const chaves = new ChavesFake();
  const app = criarApp({
    repositorios: { contas, monitoramento, chaves },
    sessao: { cookieSeguro: true, inatividadeMs: 8 * 3_600_000, duracaoMaximaMs: 7 * 86_400_000 },
    login: { maxTentativas: 3, bloqueioMs: 15 * 60_000 },
  });
  const login = (email: string, senha: string) =>
    app.inject({ method: 'POST', url: '/api/auth/login', headers: CSRF, payload: { email, senha } });
  /** Logs in and returns a request helper carrying the session cookie (+ CSRF header). */
  async function logado() {
    const r = await login('ana@exemplo.com', SENHA);
    const cookie = r.cookies.find((c) => c.name === 'vn_sessao')!;
    return (o: string | InjectOptions) =>
      app.inject({
        ...(typeof o === 'string' ? { url: o } : o),
        headers: { ...CSRF, cookie: `vn_sessao=${cookie.value}`, ...(typeof o === 'string' ? {} : o.headers) },
      });
  }
  return { app, contas, monitoramento, chaves, login, logado };
}

test('login: sucesso define cookie httpOnly, Secure, SameSite=Strict', async () => {
  const { login } = await montar();
  const r = await login('ANA@exemplo.com', SENHA);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().usuario, { id: 'u1', nome: 'Ana', email: 'ana@exemplo.com', idioma: 'pt' });
  const c = r.cookies.find((x) => x.name === 'vn_sessao')!;
  assert.equal(c.httpOnly, true);
  assert.equal(c.secure, true);
  assert.equal(c.sameSite, 'Strict');
  assert.equal(c.path, '/');
  assert.equal(c.maxAge, 7 * 86_400);
});

test('login: senha errada, e-mail inexistente e usuário inativo -> mesma resposta 401', async () => {
  const { login } = await montar();
  for (const [email, senha] of [['ana@exemplo.com', 'errada'], ['nao@existe.com', SENHA], ['inativo@exemplo.com', SENHA]]) {
    const r = await login(email!, senha!);
    assert.equal(r.statusCode, 401);
    assert.deepEqual(r.json(), { erro: 'E-mail ou senha inválidos', codigo: 'credenciais_invalidas' });
    assert.equal(r.cookies.length, 0);
  }
});

test('login: bloqueia após N falhas, mesmo com a senha certa', async () => {
  const { login } = await montar();
  for (let i = 0; i < 3; i++) await login('ana@exemplo.com', 'errada');
  const r = await login('ana@exemplo.com', SENHA);
  assert.equal(r.statusCode, 429);
  assert.equal(r.json().codigo, 'login_bloqueado');
  assert.ok(Number(r.headers['retry-after']) > 0);
});

test('CSRF: POST sem o cabeçalho -> 403', async () => {
  const { app } = await montar();
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ana@exemplo.com', senha: SENHA } });
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().codigo, 'csrf');
});

test('rotas protegidas: sem sessão ou com cookie inválido -> 401; health é público', async () => {
  const { app } = await montar();
  assert.equal((await app.inject('/api/health')).statusCode, 200);
  for (const url of ['/api/auth/eu', '/api/logs', '/api/downloads', '/api/chaves']) {
    assert.equal((await app.inject(url)).statusCode, 401, url);
  }
  const r = await app.inject({ url: '/api/auth/eu', headers: { cookie: 'vn_sessao=falso' } });
  assert.equal(r.statusCode, 401);
  assert.equal(r.json().codigo, 'nao_autenticado');
});

test('sessão: /eu, inatividade expira, logout encerra', async () => {
  const { logado, contas } = await montar();
  const req = await logado();
  assert.equal((await req('/api/auth/eu')).json().usuario.email, 'ana@exemplo.com');

  // Idle for longer than the limit.
  const real = contas.agora;
  contas.agora = () => real() + 8 * 3_600_000 + 1;
  assert.equal((await req('/api/auth/eu')).statusCode, 401);
  contas.agora = real;

  const req2 = await logado();
  assert.equal((await req2({ method: 'POST', url: '/api/auth/logout' })).statusCode, 204);
  assert.equal((await req2('/api/auth/eu')).statusCode, 401);
});

test('preferência de idioma', async () => {
  const { logado } = await montar();
  const req = await logado();
  const r = await req({ method: 'PATCH', url: '/api/auth/eu', payload: { idioma: 'en' } });
  assert.equal(r.json().usuario.idioma, 'en');
  assert.equal((await req('/api/auth/eu')).json().usuario.idioma, 'en');
  assert.equal((await req({ method: 'PATCH', url: '/api/auth/eu', payload: { idioma: 'es' } })).statusCode, 400);
});

test('chaves: criar devolve o segredo uma vez; listar nunca expõe segredo nem hash', async () => {
  const { logado } = await montar();
  const req = await logado();
  const r = await req({ method: 'POST', url: '/api/chaves', payload: { nome: ' n8n ', permissoes: ['pdf:baixar'] } });
  assert.equal(r.statusCode, 201);
  assert.equal(r.headers['cache-control'], 'no-store');
  const { chave, segredo } = r.json();
  assert.match(segredo, /^vn_[A-Za-z0-9_-]{43}$/);
  assert.equal(chave.prefixo, segredo.slice(0, 11));
  assert.equal(chave.nome, 'n8n');
  assert.equal(chave.criadaPor.id, 'u1');

  const lista = (await req('/api/chaves')).json();
  assert.deepEqual(lista.permissoesDisponiveis, ['protocolos:listar', 'pdf:baixar', 'pdf:enviar']);
  const texto = JSON.stringify(lista);
  assert.ok(!texto.includes(segredo) && !texto.includes('hash'));
});

test('chaves: validação, alteração, revogação e chave revogada imutável', async () => {
  const { logado } = await montar();
  const req = await logado();
  const post = (payload: object) => req({ method: 'POST', url: '/api/chaves', payload });
  assert.equal((await post({ nome: 'x', permissoes: [] })).statusCode, 400);
  assert.equal((await post({ nome: 'x', permissoes: ['admin'] })).statusCode, 400);
  assert.equal((await post({ nome: 'x', permissoes: ['pdf:baixar'], limitePorMinuto: 0 })).statusCode, 400);

  const { chave } = (await post({ nome: 'x', permissoes: ['pdf:baixar'], limitePorMinuto: 30 })).json();
  const alterada = await req({ method: 'PATCH', url: `/api/chaves/${chave.id}`, payload: { permissoes: ['protocolos:listar'], limitePorMinuto: null } });
  assert.deepEqual(alterada.json().chave.permissoes, ['protocolos:listar']);
  assert.equal(alterada.json().chave.limitePorMinuto, null);
  assert.equal((await req({ method: 'PATCH', url: `/api/chaves/${chave.id}`, payload: {} })).statusCode, 400);

  const revogada = await req({ method: 'POST', url: `/api/chaves/${chave.id}/revogar` });
  assert.equal(revogada.json().chave.revogadaPor.id, 'u1');
  assert.equal((await req({ method: 'POST', url: `/api/chaves/${chave.id}/revogar` })).statusCode, 409);
  assert.equal((await req({ method: 'PATCH', url: `/api/chaves/${chave.id}`, payload: { nome: 'y' } })).statusCode, 409);
  assert.equal((await req({ method: 'POST', url: '/api/chaves/00000000-0000-4000-8000-000000000000/revogar' })).statusCode, 404);
  assert.equal((await req({ method: 'POST', url: '/api/chaves/nao-e-uuid/revogar' })).statusCode, 400);
});

test('logs e downloads: filtros validados e paginação padrão', async () => {
  const { logado, monitoramento } = await montar();
  const req = await logado();
  assert.equal((await req('/api/logs')).statusCode, 200);
  assert.deepEqual({ ...(monitoramento.ultimosFiltros as object) }, { pagina: 1, porPagina: 50 });
  const de = '2026-11-01T00:00:00.000Z';
  await req(`/api/logs?de=${de}&status=502&origem=api&pagina=2&porPagina=10`);
  assert.deepEqual({ ...(monitoramento.ultimosFiltros as object) }, { de, status: 502, origem: 'api', pagina: 2, porPagina: 10 });

  assert.equal((await req('/api/logs?de=ontem')).statusCode, 400);
  assert.equal((await req('/api/logs?porPagina=1000')).statusCode, 400);
  assert.equal((await req('/api/logs?xpto=1')).statusCode, 400);
  assert.equal((await req('/api/logs/abc')).statusCode, 400);
  assert.equal((await req('/api/logs/123')).statusCode, 404);

  assert.equal((await req('/api/downloads?resultado=erro&tipo=envio&protocolo=123')).statusCode, 200);
  assert.equal((await req('/api/downloads?resultado=talvez')).statusCode, 400);
});

test('erro interno -> 500 genérico e registro no log de erros (origem dashboard)', async () => {
  const { logado, monitoramento } = await montar();
  const req = await logado();
  monitoramento.falharListagem = true;
  const r = await req('/api/logs');
  assert.equal(r.statusCode, 500);
  assert.deepEqual(r.json(), { erro: 'Erro interno. Tente novamente.', codigo: 'erro_interno' });
  assert.equal(monitoramento.erros.length, 1);
  assert.equal(monitoramento.erros[0]!.rota, '/api/logs');
  assert.match(monitoramento.erros[0]!.mensagem, /banco fora do ar/);
});

test('troca de senha: exige a atual, valida a nova e encerra as outras sessões', async () => {
  const { logado, login } = await montar();
  const req = await logado();
  const outra = await logado(); // second open session of the same user
  const trocar = (senhaAtual: string, novaSenha: string) =>
    req({ method: 'POST', url: '/api/auth/eu/senha', payload: { senhaAtual, novaSenha } });

  assert.equal((await trocar('errada', 'nova-senha-longa')).json().codigo, 'senha_atual_incorreta');
  assert.equal((await trocar(SENHA, 'curta')).json().codigo, 'senha_curta');
  assert.equal((await trocar(SENHA, SENHA)).json().codigo, 'senha_igual');
  assert.equal((await trocar(SENHA, 'nova-senha-longa')).statusCode, 204);

  assert.equal((await req('/api/auth/eu')).statusCode, 200); // current session kept
  assert.equal((await outra('/api/auth/eu')).statusCode, 401); // other session ended
  assert.equal((await login('ana@exemplo.com', SENHA)).statusCode, 401);
  assert.equal((await login('ana@exemplo.com', 'nova-senha-longa')).statusCode, 200);
});

test('cabeçalhos de segurança e no-store nas respostas da API; 404 em JSON', async () => {
  const { app } = await montar();
  const r = await app.inject('/api/health');
  assert.match(String(r.headers['content-security-policy']), /frame-ancestors 'none'/);
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['cache-control'], 'no-store');
  const nf = await app.inject('/qualquer');
  assert.equal(nf.statusCode, 404);
  assert.equal(nf.json().codigo, 'nao_encontrado');
});

test('frontend: /, rotas da SPA e assets; arquivo inexistente -> 404', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const pasta = mkdtempSync(join(tmpdir(), 'vn-web-'));
  writeFileSync(join(pasta, 'index.html'), '<!doctype html><title>app</title>');
  mkdirSync(join(pasta, 'assets'));
  writeFileSync(join(pasta, 'assets', 'app.js'), 'console.log(1)');
  const comWeb = criarApp({
    repositorios: { contas: new ContasFake(), monitoramento: new MonitoramentoFake(), chaves: new ChavesFake() },
    sessao: { cookieSeguro: true, inatividadeMs: 1, duracaoMaximaMs: 1 }, login: { maxTentativas: 1, bloqueioMs: 1 },
    pastaWeb: pasta,
  });
  for (const url of ['/', '/logs', '/chaves?apiKeyId=x']) {
    const r = await comWeb.inject(url);
    assert.equal(r.statusCode, 200, url);
    assert.match(r.body, /<title>app<\/title>/, url);
  }
  const js = await comWeb.inject('/assets/app.js');
  assert.equal(js.statusCode, 200);
  assert.match(String(js.headers['content-type']), /javascript/);
  assert.equal((await comWeb.inject('/assets/nao-existe.js')).statusCode, 404);
  assert.equal((await comWeb.inject('/api/nao-existe')).statusCode, 401); // API stays protected
});
