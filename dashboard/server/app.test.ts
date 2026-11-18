// Dashboard HTTP API with in-memory repositories (no database).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InjectOptions } from 'fastify';
import { criarApp } from './app.ts';
import { hashSenha } from './auth/passwords.ts';
import { ChavesFake, ContasFake, CredenciaisFake, MonitoramentoFake, UsuariosFake, usuarioFake } from './tests/fakes.ts';
import { decifrarSenha } from './utils/credentials-crypto.ts';

const CHAVE_HMAC = 'k'.repeat(32);
const CHAVE_CREDENCIAIS = Buffer.alloc(32, 7);

const SENHA = 'senha-de-teste-123';
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const CORRETOR = '00000000-0000-4000-8000-0000000000c1';
const OUTRO = '00000000-0000-4000-8000-0000000000c2';
const CSRF = { 'x-requested-with': 'vetornorte-dashboard' };

async function montar() {
  const contas = new ContasFake();
  const senhaHash = await hashSenha(SENHA);
  contas.usuarios.push(
    usuarioFake({ id: ADMIN, nome: 'Ana', email: 'ana@exemplo.com', senhaHash, perfil: 'admin' }),
    usuarioFake({ id: 'u2', nome: 'Inativo', email: 'inativo@exemplo.com', senhaHash, ativo: false }),
    // Corretor with downloads + keys granted (not queries), ceiling: list + download.
    usuarioFake({
      id: CORRETOR, nome: 'Bia', email: 'bia@exemplo.com', senhaHash, telas: ['downloads', 'chaves'],
      permissoesApi: ['protocolos:listar', 'pdf:baixar'],
    }),
    usuarioFake({ id: OUTRO, nome: 'Caio', email: 'caio@exemplo.com', senhaHash, telas: ['chaves'], permissoesApi: ['pdf:baixar'] }),
  );
  const monitoramento = new MonitoramentoFake();
  const chaves = new ChavesFake();
  const credenciais = new CredenciaisFake(contas);
  const usuarios = new UsuariosFake(contas, chaves, credenciais);
  const app = criarApp({
    repositorios: { contas, usuarios, credenciais, monitoramento, chaves },
    sessao: { cookieSeguro: true, inatividadeMs: 8 * 3_600_000, duracaoMaximaMs: 7 * 86_400_000 },
    login: { maxTentativas: 3, bloqueioMs: 15 * 60_000 },
    chaveHmacCpf: CHAVE_HMAC,
    chaveCredenciais: CHAVE_CREDENCIAIS,
  });
  const login = (email: string, senha: string) =>
    app.inject({ method: 'POST', url: '/api/auth/login', headers: CSRF, payload: { email, senha } });
  /** Logs in and returns a request helper carrying the session cookie (+ CSRF header). */
  async function logado(email = 'ana@exemplo.com', senha = SENHA) {
    const r = await login(email, senha);
    const cookie = r.cookies.find((c) => c.name === 'vn_sessao')!;
    return (o: string | InjectOptions) =>
      app.inject({
        ...(typeof o === 'string' ? { url: o } : o),
        headers: { ...CSRF, cookie: `vn_sessao=${cookie.value}`, ...(typeof o === 'string' ? {} : o.headers) },
      });
  }
  return { app, contas, usuarios, credenciais, monitoramento, chaves, login, logado };
}

test('login: sucesso define cookie httpOnly, Secure, SameSite=Strict', async () => {
  const { login } = await montar();
  const r = await login('ANA@exemplo.com', SENHA);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().usuario, {
    id: ADMIN, nome: 'Ana', email: 'ana@exemplo.com', idioma: 'pt', perfil: 'admin', telas: [], permissoesApi: [],
    trocarSenha: false,
  });
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
  for (const url of ['/api/auth/eu', '/api/logs', '/api/consultas', '/api/downloads', '/api/chaves']) {
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
  assert.equal(chave.criadaPor.id, ADMIN);
  assert.equal(chave.dono.id, ADMIN);

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
  assert.equal(revogada.json().chave.revogadaPor.id, ADMIN);
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

test('consultas: CPF vira só o hash (igual ao da API), filtros validados', async () => {
  const { logado, monitoramento } = await montar();
  const req = await logado();
  assert.equal((await req('/api/consultas')).statusCode, 200);
  assert.deepEqual({ ...(monitoramento.ultimosFiltros as object) }, { pagina: 1, porPagina: 50 });

  const r = await req('/api/consultas?cpf=529.982.247-25&protocolo=10&resultado=erro');
  assert.equal(r.statusCode, 200);
  const filtros = { ...(monitoramento.ultimosFiltros as Record<string, unknown>) };
  // Same fixed vector as api/src/audit/audit.test.ts (key 'k' x 32): API and dashboard must agree.
  assert.deepEqual(filtros, {
    cpfHash: 'a9032b49a90d0833a723bdbc00b3d0d0875a34eb27db967b9f4a761416f694f4',
    protocolo: '10', resultado: 'erro', pagina: 1, porPagina: 50,
  });
  await req('/api/consultas?cpf=52998224725');
  assert.equal((monitoramento.ultimosFiltros as { cpfHash: string }).cpfHash, filtros.cpfHash);

  assert.equal((await req('/api/consultas?cpf=123')).statusCode, 400);
  assert.equal((await req('/api/consultas?resultado=sem_pdf')).statusCode, 400);
  assert.equal((await req('/api/consultas?xpto=1')).statusCode, 400);
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
  assert.equal(monitoramento.erros[0]!.usuarioId, ADMIN);
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
    repositorios: {
      contas: new ContasFake(), usuarios: new UsuariosFake(new ContasFake(), new ChavesFake()),
      credenciais: new CredenciaisFake(new ContasFake()), monitoramento: new MonitoramentoFake(), chaves: new ChavesFake(),
    },
    sessao: { cookieSeguro: true, inatividadeMs: 1, duracaoMaximaMs: 1 }, login: { maxTentativas: 1, bloqueioMs: 1 },
    chaveHmacCpf: CHAVE_HMAC,
    chaveCredenciais: CHAVE_CREDENCIAIS,
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

// ---- Profiles (stage 14) ----

test('acesso: corretor só vê as telas liberadas; erros e usuários são só do admin', async () => {
  const { logado } = await montar();
  const bia = await logado('bia@exemplo.com');
  assert.equal((await bia('/api/auth/eu')).json().usuario.perfil, 'corretor');
  for (const url of ['/api/logs', '/api/logs/1', '/api/usuarios', '/api/consultas']) {
    const r = await bia(url);
    assert.equal(r.statusCode, 403, url);
    assert.equal(r.json().codigo, 'acesso_negado', url);
  }
  assert.equal((await bia('/api/downloads')).statusCode, 200);
  assert.equal((await bia('/api/chaves')).statusCode, 200);

  const ana = await logado();
  for (const url of ['/api/logs', '/api/usuarios', '/api/consultas', '/api/downloads', '/api/chaves']) {
    assert.equal((await ana(url)).statusCode, 200, url);
  }
});

test('isolamento: corretor sempre filtrado por si mesmo; admin escolhe o filtro', async () => {
  const { logado, monitoramento } = await montar();
  const bia = await logado('bia@exemplo.com');
  await bia(`/api/downloads?usuarioId=${OUTRO}`);
  assert.equal((monitoramento.ultimosFiltros as { usuarioId: string }).usuarioId, CORRETOR);

  const ana = await logado();
  await ana('/api/downloads');
  assert.equal((monitoramento.ultimosFiltros as { usuarioId?: string }).usuarioId, undefined);
  await ana(`/api/consultas?usuarioId=${OUTRO}`);
  assert.equal((monitoramento.ultimosFiltros as { usuarioId: string }).usuarioId, OUTRO);
  await ana(`/api/logs?usuarioId=${OUTRO}`);
  assert.equal((monitoramento.ultimosFiltros as { usuarioId: string }).usuarioId, OUTRO);
});

test('chaves do corretor: só as próprias, dentro do teto, sem rate limit', async () => {
  const { logado } = await montar();
  const ana = await logado();
  const daCaio = (await ana({ method: 'POST', url: '/api/chaves', payload: { nome: 'c', permissoes: ['pdf:baixar'], usuarioId: OUTRO } })).json().chave;

  const bia = await logado('bia@exemplo.com');
  const post = (payload: object) => bia({ method: 'POST', url: '/api/chaves', payload });
  const fora = await post({ nome: 'x', permissoes: ['pdf:enviar'] });
  assert.equal(fora.statusCode, 400);
  assert.deepEqual([fora.json().codigo, fora.json().permissoes], ['permissao_fora_do_limite', ['pdf:enviar']]);
  assert.equal((await post({ nome: 'x', permissoes: ['pdf:baixar'], limitePorMinuto: 5 })).json().codigo, 'apenas_admin');
  assert.equal((await post({ nome: 'x', permissoes: ['pdf:baixar'], usuarioId: OUTRO })).statusCode, 403);

  const minha = await post({ nome: 'minha', permissoes: ['pdf:baixar'] });
  assert.equal(minha.statusCode, 201);
  assert.equal(minha.json().chave.dono.id, CORRETOR);

  const lista = (await bia('/api/chaves')).json();
  assert.deepEqual(lista.chaves.map((c: { nome: string }) => c.nome), ['minha']);
  assert.deepEqual(lista.permissoesDisponiveis, ['protocolos:listar', 'pdf:baixar']);
  // Someone else's key does not exist for her.
  assert.equal((await bia({ method: 'PATCH', url: `/api/chaves/${daCaio.id}`, payload: { nome: 'y' } })).statusCode, 404);
  assert.equal((await bia({ method: 'POST', url: `/api/chaves/${daCaio.id}/revogar` })).statusCode, 404);
  const id = minha.json().chave.id;
  assert.equal((await bia({ method: 'PATCH', url: `/api/chaves/${id}`, payload: { limitePorMinuto: 5 } })).json().codigo, 'apenas_admin');
  assert.equal((await bia({ method: 'PATCH', url: `/api/chaves/${id}`, payload: { permissoes: ['pdf:enviar'] } })).statusCode, 400);
  assert.equal((await bia({ method: 'POST', url: `/api/chaves/${id}/revogar` })).statusCode, 200);

  // The admin sees every key and can filter by owner.
  assert.equal((await ana('/api/chaves')).json().chaves.length, 2);
  assert.equal((await ana(`/api/chaves?usuarioId=${OUTRO}`)).json().chaves.length, 1);
});

test('chaves pelo admin para outro usuário: teto do dono, usuário inativo ou inexistente', async () => {
  const { logado, contas } = await montar();
  const ana = await logado();
  const post = (payload: object) => ana({ method: 'POST', url: '/api/chaves', payload });
  assert.equal((await post({ nome: 'x', permissoes: ['pdf:enviar'], usuarioId: CORRETOR })).json().codigo, 'permissao_fora_do_limite');
  assert.equal((await post({ nome: 'x', permissoes: ['pdf:baixar'], usuarioId: '00000000-0000-4000-8000-000000000999' })).statusCode, 404);
  contas.usuarios.find((u) => u.id === OUTRO)!.ativo = false;
  assert.equal((await post({ nome: 'x', permissoes: ['pdf:baixar'], usuarioId: OUTRO })).json().codigo, 'usuario_inativo');
  const ok = await post({ nome: 'x', permissoes: ['pdf:baixar'], usuarioId: CORRETOR, limitePorMinuto: 10 });
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.json().chave.dono.id, CORRETOR);
  assert.equal(ok.json().chave.criadaPor.id, ADMIN);
});

test('usuários: admin cria com senha temporária; troca obrigatória bloqueia o resto', async () => {
  const { logado, login } = await montar();
  const ana = await logado();
  const r = await ana({
    method: 'POST', url: '/api/usuarios',
    payload: { nome: ' Davi ', email: 'Davi@Exemplo.com', perfil: 'corretor', telas: ['consultas'], permissoesApi: ['protocolos:listar'] },
  });
  assert.equal(r.statusCode, 201);
  assert.equal(r.headers['cache-control'], 'no-store');
  const { usuario, senhaTemporaria } = r.json();
  assert.deepEqual([usuario.nome, usuario.email, usuario.trocarSenha], ['Davi', 'davi@exemplo.com', true]);
  assert.match(senhaTemporaria, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(JSON.stringify((await ana('/api/usuarios')).json()).includes(senhaTemporaria), false);

  const dup = await ana({ method: 'POST', url: '/api/usuarios', payload: { nome: 'x', email: 'DAVI@exemplo.com', perfil: 'admin' } });
  assert.equal(dup.json().codigo, 'email_em_uso');
  assert.equal((await ana({ method: 'POST', url: '/api/usuarios', payload: { nome: 'x', email: 'y@z.com', perfil: 'chefe' } })).statusCode, 400);
  assert.equal((await ana({ method: 'POST', url: '/api/usuarios', payload: { nome: 'x', email: 'y@z.com', perfil: 'corretor', telas: ['logs'] } })).statusCode, 400);

  const login1 = await login('davi@exemplo.com', senhaTemporaria);
  assert.equal(login1.json().usuario.trocarSenha, true);
  const davi = await logado('davi@exemplo.com', senhaTemporaria);
  assert.equal((await davi('/api/consultas')).json().codigo, 'troca_senha_obrigatoria');
  assert.equal((await davi('/api/auth/eu')).statusCode, 200);
  const troca = await davi({ method: 'POST', url: '/api/auth/eu/senha', payload: { senhaAtual: senhaTemporaria, novaSenha: 'senha-do-davi-1' } });
  assert.equal(troca.statusCode, 204);
  assert.equal((await davi('/api/auth/eu')).json().usuario.trocarSenha, false);
  assert.equal((await davi('/api/consultas')).statusCode, 200);
});

test('usuários: remover permissão do teto tira das chaves, e devolver não restaura', async () => {
  const { logado, chaves } = await montar();
  const ana = await logado();
  await ana({ method: 'POST', url: '/api/chaves', payload: { nome: 'k', permissoes: ['protocolos:listar', 'pdf:baixar'], usuarioId: CORRETOR } });
  const patch = (payload: object) => ana({ method: 'PATCH', url: `/api/usuarios/${CORRETOR}`, payload });

  assert.deepEqual((await patch({ permissoesApi: ['protocolos:listar'] })).json().usuario.permissoesApi, ['protocolos:listar']);
  assert.deepEqual(chaves.chaves[0]!.permissoes, ['protocolos:listar']);
  await patch({ permissoesApi: ['protocolos:listar', 'pdf:baixar'] });
  assert.deepEqual(chaves.chaves[0]!.permissoes, ['protocolos:listar']);

  const outro = await patch({ email: 'caio@exemplo.com' });
  assert.equal(outro.json().codigo, 'email_em_uso');
  assert.equal((await patch({})).statusCode, 400);
  assert.equal((await ana({ method: 'PATCH', url: '/api/usuarios/00000000-0000-4000-8000-000000000999', payload: { nome: 'x' } })).statusCode, 404);
});

test('usuários: desativar e redefinir senha encerram sessões; admin não mexe em si mesmo', async () => {
  const { logado, login } = await montar();
  const ana = await logado();
  const bia = await logado('bia@exemplo.com');

  assert.equal((await ana({ method: 'POST', url: `/api/usuarios/${CORRETOR}/desativar` })).json().usuario.ativo, false);
  assert.equal((await bia('/api/auth/eu')).statusCode, 401);
  assert.equal((await ana({ method: 'POST', url: `/api/usuarios/${CORRETOR}/ativar` })).json().usuario.ativo, true);

  const bia2 = await logado('bia@exemplo.com');
  const r = await ana({ method: 'POST', url: `/api/usuarios/${CORRETOR}/redefinir-senha` });
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal((await bia2('/api/auth/eu')).statusCode, 401);
  assert.equal((await login('bia@exemplo.com', SENHA)).statusCode, 401);
  assert.equal((await login('bia@exemplo.com', r.json().senhaTemporaria)).json().usuario.trocarSenha, true);

  for (const acao of ['desativar', 'redefinir-senha']) {
    assert.equal((await ana({ method: 'POST', url: `/api/usuarios/${ADMIN}/${acao}` })).json().codigo, 'proprio_usuario', acao);
  }
  assert.equal((await ana({ method: 'PATCH', url: `/api/usuarios/${ADMIN}`, payload: { perfil: 'corretor' } })).json().codigo, 'proprio_usuario');
  assert.equal((await ana({ method: 'PATCH', url: `/api/usuarios/${ADMIN}`, payload: { nome: 'Ana Maria' } })).statusCode, 200);
});

test('rota protegida sem config.acesso falha na inicialização', async () => {
  const { app } = await montar();
  app.register(async (i) => i.get('/api/sem-acesso', async () => ({})));
  await assert.rejects(async () => { await app.ready(); }, /sem config\.acesso/);
});

// ---- Portal credentials (stage 16) ----

test('credenciais: cada usuário cadastra as próprias; senha cifrada com o id do usuário e nunca devolvida', async () => {
  const { logado, credenciais } = await montar();
  const bia = await logado('bia@exemplo.com');
  assert.deepEqual((await bia('/api/credenciais')).json(), { credencial: null });

  const r = await bia({ method: 'PUT', url: '/api/credenciais', payload: { emailPortal: ' bia@portal.com ', senha: ' segredo do portal ' } });
  assert.equal(r.statusCode, 200);
  const { credencial } = r.json();
  assert.deepEqual([credencial.emailPortal, credencial.status, credencial.atualizadaPor.id], ['bia@portal.com', 'nao_testada', CORRETOR]);
  assert.ok(!r.body.includes('segredo'));
  assert.ok(!(await bia('/api/credenciais')).body.includes('segredo'));

  const salva = credenciais.linhas.get(CORRETOR)!;
  assert.equal(decifrarSenha(salva.senhaCifrada, CHAVE_CREDENCIAIS, CORRETOR), ' segredo do portal ');
  assert.throws(() => decifrarSenha(salva.senhaCifrada, CHAVE_CREDENCIAIS, OUTRO));

  // Invalid status goes back to "not tested" when updated.
  salva.status = 'invalida';
  await bia({ method: 'PUT', url: '/api/credenciais', payload: { emailPortal: 'bia@portal.com', senha: 'nova' } });
  assert.equal(credenciais.linhas.get(CORRETOR)!.status, 'nao_testada');

  for (const payload of [{ emailPortal: 'sem-arroba', senha: 'x' }, { emailPortal: 'a@b.com', senha: '' }, { emailPortal: 'a@b.com' }]) {
    assert.equal((await bia({ method: 'PUT', url: '/api/credenciais', payload })).statusCode, 400);
  }
});

test('credenciais: admin cadastra para outro usuário e vê o status na lista; corretor não', async () => {
  const { logado, credenciais } = await montar();
  const ana = await logado();
  const r = await ana({ method: 'PUT', url: `/api/usuarios/${CORRETOR}/credenciais`, payload: { emailPortal: 'bia@portal.com', senha: 'abc' } });
  assert.equal(r.json().credencial.atualizadaPor.id, ADMIN);
  assert.equal(decifrarSenha(credenciais.linhas.get(CORRETOR)!.senhaCifrada, CHAVE_CREDENCIAIS, CORRETOR), 'abc');

  const lista = (await ana('/api/usuarios')).json().usuarios as { id: string; credencialPortal: { status: string } | null }[];
  assert.equal(lista.find((u) => u.id === CORRETOR)!.credencialPortal!.status, 'nao_testada');
  assert.equal(lista.find((u) => u.id === OUTRO)!.credencialPortal, null);
  assert.ok(!JSON.stringify(lista).includes('senha'));
  assert.equal((await ana({ method: 'PUT', url: '/api/usuarios/00000000-0000-4000-8000-000000000999/credenciais', payload: { emailPortal: 'a@b.com', senha: 'x' } })).statusCode, 404);

  const bia = await logado('bia@exemplo.com');
  const negado = await bia({ method: 'PUT', url: `/api/usuarios/${OUTRO}/credenciais`, payload: { emailPortal: 'a@b.com', senha: 'x' } });
  assert.equal(negado.json().codigo, 'acesso_negado');
});
