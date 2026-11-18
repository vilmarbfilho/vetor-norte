// Per-user session manager (fake sessions, repository and clock; no browser, no database).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cifrarSenha } from '../credentials/crypto.ts';
import type { CredencialPortal, RepositorioCredenciais } from '../credentials/repository.ts';
import { ErroLoginRecusado } from './portal.ts';
import { ErroCredenciais, GerenciadorSessoes, type SessaoUsuario } from './sessions.ts';

const CHAVE = Buffer.alloc(32, 3);
const SENHA_RECUSADA = 'senha-errada';

class RepositorioFake implements RepositorioCredenciais {
  readonly linhas = new Map<string, CredencialPortal>();
  salvar(usuarioId: string, senha: string, versao = '1') {
    this.linhas.set(usuarioId, {
      email: `${usuarioId}@portal.test`, senhaCifrada: cifrarSenha(senha, CHAVE, usuarioId), status: 'nao_testada', versao,
    });
  }
  async obter(id: string) {
    return this.linhas.get(id) ?? null;
  }
  async marcarValida(id: string, versao: string) {
    const l = this.linhas.get(id);
    if (l?.versao === versao) l.status = 'valida';
  }
  async marcarInvalida(id: string, versao: string) {
    const l = this.linhas.get(id);
    if (l?.versao === versao) l.status = 'invalida';
  }
}

/** Fake session: "logs in" on first use (refused when the password is SENHA_RECUSADA). */
class SessaoFake implements SessaoUsuario<string> {
  logins = 0;
  encerrada = false;
  ocupada = false;
  ultima: number;
  constructor(readonly usuarioId: string, readonly senha: string, private readonly aoLogar: () => void, private readonly relogio: () => number) {
    this.ultima = relogio();
  }
  async executar<T>(op: (r: string) => Promise<T>): Promise<T> {
    this.ocupada = true;
    try {
      if (this.logins === 0) {
        this.logins++;
        if (this.senha === SENHA_RECUSADA) throw new ErroLoginRecusado('HTTP 400');
        this.aoLogar();
      }
      return await op(this.usuarioId);
    } finally {
      this.ocupada = false;
      this.ultima = this.relogio();
    }
  }
  ociosaHaMs(agora = this.relogio()) {
    return agora - this.ultima;
  }
  async encerrar() {
    this.encerrada = true;
  }
}

function montar(max = 5) {
  let agora = 0;
  const repositorio = new RepositorioFake();
  const criadas: SessaoFake[] = [];
  const gerenciador = new GerenciadorSessoes<string>({
    repositorio, chave: CHAVE, ociosaMs: 15 * 60_000, max, agora: () => agora,
    criarSessao: ({ usuarioId, senha, aoLogar }) => {
      const s = new SessaoFake(usuarioId, senha, aoLogar, () => agora);
      criadas.push(s);
      return s;
    },
  });
  const usar = (id: string) => gerenciador.executar(id, async (r) => r);
  return { repositorio, criadas, gerenciador, usar, avancar: (ms: number) => (agora += ms) };
}

test('sessões: cada usuário tem a sua, logada com a própria senha (decifrada), e é reutilizada', async () => {
  const { repositorio, criadas, usar, gerenciador } = montar();
  repositorio.salvar('a', 'senha-a');
  repositorio.salvar('b', 'senha-b');
  assert.equal(await usar('a'), 'a');
  assert.equal(await usar('a'), 'a');
  assert.equal(await usar('b'), 'b');
  assert.deepEqual(criadas.map((s) => [s.usuarioId, s.senha, s.logins]), [['a', 'senha-a', 1], ['b', 'senha-b', 1]]);
  assert.equal(repositorio.linhas.get('a')!.status, 'valida');
  assert.deepEqual(gerenciador.status, { sessoesAbertas: 2, maximo: 5 });
});

test('sessões: sem credenciais ou credencial inválida -> ErroCredenciais, sem abrir sessão', async () => {
  const { repositorio, criadas, usar } = montar();
  await assert.rejects(usar('x'), (e: ErroCredenciais) => e.codigo === 'credenciais_nao_cadastradas');
  repositorio.salvar('x', 'qualquer');
  repositorio.linhas.get('x')!.status = 'invalida';
  await assert.rejects(usar('x'), (e: ErroCredenciais) => e.codigo === 'credenciais_invalidas');
  assert.equal(criadas.length, 0);
});

test('sessões: login recusado marca inválida e não tenta de novo até salvar outra senha', async () => {
  const { repositorio, criadas, usar } = montar();
  repositorio.salvar('a', SENHA_RECUSADA);
  await assert.rejects(usar('a'), (e: ErroCredenciais) => e.codigo === 'credenciais_invalidas');
  assert.equal(repositorio.linhas.get('a')!.status, 'invalida');
  assert.ok(criadas[0]!.encerrada);
  await assert.rejects(usar('a'), ErroCredenciais);
  assert.equal(criadas.length, 1); // no new login attempt

  repositorio.salvar('a', 'senha-nova', '2'); // the user saved the current password in the dashboard
  assert.equal(await usar('a'), 'a');
  assert.equal(repositorio.linhas.get('a')!.status, 'valida');
});

test('sessões: credenciais atualizadas (nova versão) encerram a sessão antiga', async () => {
  const { repositorio, criadas, usar } = montar();
  repositorio.salvar('a', 'senha-1');
  await usar('a');
  repositorio.salvar('a', 'senha-2', '2');
  await usar('a');
  assert.equal(criadas.length, 2);
  assert.ok(criadas[0]!.encerrada);
  assert.equal(criadas[1]!.senha, 'senha-2');
});

test('sessões: CREDENCIAIS_CHAVE diferente da do dashboard -> erro técnico claro', async () => {
  const { repositorio, usar } = montar();
  repositorio.salvar('a', 'senha');
  repositorio.linhas.get('a')!.senhaCifrada = cifrarSenha('senha', Buffer.alloc(32, 9), 'a');
  await assert.rejects(usar('a'), /CREDENCIAIS_CHAVE/);
});

test('sessões: ociosas por 15 min são encerradas; ocupadas não', async () => {
  const { repositorio, criadas, usar, avancar, gerenciador } = montar();
  repositorio.salvar('a', 'sa');
  repositorio.salvar('b', 'sb');
  await usar('a');
  avancar(10 * 60_000);
  await usar('b');
  avancar(5 * 60_000);
  criadas[0]!.ocupada = true;
  assert.equal(gerenciador.limparOciosas(), 0); // a is busy, b idle only 5 min
  criadas[0]!.ocupada = false;
  assert.equal(gerenciador.limparOciosas(), 1);
  assert.ok(criadas[0]!.encerrada);
  assert.ok(!criadas[1]!.encerrada);
  await usar('a'); // logs in again
  assert.equal(criadas.length, 3);
});

test('sessões: no limite (SESSOES_MAX), a mais ociosa é encerrada para abrir outra', async () => {
  const { repositorio, criadas, usar, avancar, gerenciador } = montar(2);
  for (const id of ['a', 'b', 'c']) repositorio.salvar(id, `s${id}`);
  await usar('a');
  avancar(1000);
  await usar('b');
  avancar(1000);
  await usar('c');
  assert.ok(criadas[0]!.encerrada);
  assert.ok(!criadas[1]!.encerrada);
  assert.equal(gerenciador.status.sessoesAbertas, 2);
});

test('sessões: pedidos simultâneos do mesmo usuário compartilham uma sessão', async () => {
  const { repositorio, criadas, usar } = montar();
  repositorio.salvar('a', 'sa');
  await Promise.all([usar('a'), usar('a'), usar('a')]);
  assert.equal(criadas.length, 1);
});
