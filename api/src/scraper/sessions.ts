// One portal session per user (the owner of the API key), each logged in with that user's own credentials.
//
// - Credentials are read from the database on every request. Saving new ones in the dashboard changes
//   their version (`atualizada_em`), so the old session is closed and the next request logs in again.
// - No credentials → ErroCredenciais('credenciais_nao_cadastradas').
// - Status 'invalida' → ErroCredenciais('credenciais_invalidas') WITHOUT touching the portal (no new login
//   attempts until the user saves the current password).
// - The portal refuses the login → status 'invalida' + ErroCredenciais('credenciais_invalidas').
// - A successful login → status 'valida' (+ ultimo_login_ok_em).
// - Sessions idle for SESSAO_OCIOSA_MINUTOS are closed; at most SESSOES_MAX are open (the most idle
//   one is closed to make room).

import type { RepositorioCredenciais } from '../credentials/repository.ts';
import { decifrarSenha } from '../credentials/crypto.ts';
import { ErroLoginRecusado } from './portal.ts';

const log = (msg: string) => console.log(`[sessoes] ${msg}`);

export type CodigoCredenciais = 'credenciais_nao_cadastradas' | 'credenciais_invalidas';

/** The key owner's portal credentials are missing or refused. A business outcome for the caller (409). */
export class ErroCredenciais extends Error {
  constructor(readonly codigo: CodigoCredenciais) {
    super(
      codigo === 'credenciais_nao_cadastradas'
        ? 'Credenciais do portal não cadastradas para o dono desta chave. Cadastre-as no dashboard.'
        : 'As credenciais do portal foram recusadas pelo portal. Atualize-as no dashboard.',
    );
    this.name = 'ErroCredenciais';
  }
}

/** What the manager needs from a session (SessaoBroker in production, a fake in tests). */
export interface SessaoUsuario<R> {
  executar<T>(operacao: (r: R) => Promise<T>): Promise<T>;
  readonly ocupada: boolean;
  ociosaHaMs(agora?: number): number;
  encerrar(): Promise<void>;
}

export interface OpcoesGerenciador<R> {
  repositorio: RepositorioCredenciais;
  /** CREDENCIAIS_CHAVE (same value as the dashboard). */
  chave: Buffer;
  criarSessao(dados: { usuarioId: string; email: string; senha: string; aoLogar: () => void }): SessaoUsuario<R>;
  ociosaMs: number;
  max: number;
  agora?: () => number;
}

interface Aberta<R> {
  sessao: SessaoUsuario<R>;
  versao: string;
}

export class GerenciadorSessoes<R> {
  private readonly sessoes = new Map<string, Aberta<R>>();
  private timer?: NodeJS.Timeout;
  private readonly agora: () => number;

  constructor(private readonly opcoes: OpcoesGerenciador<R>) {
    this.agora = opcoes.agora ?? Date.now;
  }

  get status() {
    // Public (/health): counts only, never which users are logged in.
    return { sessoesAbertas: this.sessoes.size, maximo: this.opcoes.max };
  }

  /** Runs an operation in the user's session (opening it if needed). */
  async executar<T>(usuarioId: string, operacao: (r: R) => Promise<T>): Promise<T> {
    const credencial = await this.opcoes.repositorio.obter(usuarioId);
    if (!credencial || credencial.status === 'invalida') {
      this.fechar(usuarioId);
      throw new ErroCredenciais(credencial ? 'credenciais_invalidas' : 'credenciais_nao_cadastradas');
    }

    // From here to the Map.set there is no await: concurrent requests of a user share one session.
    let aberta = this.sessoes.get(usuarioId);
    if (aberta && aberta.versao !== credencial.versao) {
      log('Credenciais atualizadas: sessão anterior encerrada');
      this.fechar(usuarioId);
      aberta = undefined;
    }
    if (!aberta) {
      let senha: string;
      try {
        senha = decifrarSenha(credencial.senhaCifrada, this.opcoes.chave, usuarioId);
      } catch {
        throw new Error('Não foi possível decifrar a senha do portal (CREDENCIAIS_CHAVE diferente da do dashboard?)');
      }
      this.abrirEspaco();
      const { repositorio } = this.opcoes;
      const versao = credencial.versao;
      aberta = {
        versao,
        sessao: this.opcoes.criarSessao({
          usuarioId,
          email: credencial.email,
          senha,
          aoLogar: () =>
            void repositorio.marcarValida(usuarioId, versao).catch((e) => log(`Falha ao gravar status: ${(e as Error).message}`)),
        }),
      };
      this.sessoes.set(usuarioId, aberta);
    }

    try {
      return await aberta.sessao.executar(operacao);
    } catch (e) {
      if (!(e instanceof ErroLoginRecusado)) throw e;
      log('Login recusado pelo portal: credenciais marcadas como inválidas');
      await this.opcoes.repositorio.marcarInvalida(usuarioId, aberta.versao);
      if (this.sessoes.get(usuarioId) === aberta) this.fechar(usuarioId);
      throw new ErroCredenciais('credenciais_invalidas');
    }
  }

  /** Closes the most idle free session when the limit is reached. If all are busy, the limit is exceeded briefly. */
  private abrirEspaco(): void {
    if (this.sessoes.size < this.opcoes.max) return;
    const agora = this.agora();
    let alvo: [string, number] | undefined;
    for (const [id, { sessao }] of this.sessoes) {
      if (sessao.ocupada) continue;
      const ociosa = sessao.ociosaHaMs(agora);
      if (!alvo || ociosa > alvo[1]) alvo = [id, ociosa];
    }
    if (!alvo) return log(`Todas as ${this.sessoes.size} sessões estão ocupadas: limite excedido temporariamente`);
    log('Limite de sessões atingido: a mais ociosa foi encerrada');
    this.fechar(alvo[0]);
  }

  /** Closes sessions idle for longer than the limit. Public for tests. */
  limparOciosas(): number {
    const agora = this.agora();
    let fechadas = 0;
    for (const [id, { sessao }] of this.sessoes) {
      if (!sessao.ocupada && sessao.ociosaHaMs(agora) >= this.opcoes.ociosaMs) {
        this.fechar(id);
        fechadas++;
      }
    }
    if (fechadas) log(`${fechadas} sessão(ões) ociosa(s) encerrada(s)`);
    return fechadas;
  }

  /** Checks for idle sessions every minute (timer is unref'd). */
  iniciarLimpeza(intervaloMs = 60_000): void {
    this.timer = setInterval(() => this.limparOciosas(), intervaloMs);
    this.timer.unref();
  }

  private fechar(usuarioId: string): void {
    const aberta = this.sessoes.get(usuarioId);
    if (!aberta) return;
    this.sessoes.delete(usuarioId);
    void aberta.sessao.encerrar().catch(() => {});
  }

  async encerrarTodas(): Promise<void> {
    clearInterval(this.timer);
    const todas = [...this.sessoes.values()];
    this.sessoes.clear();
    await Promise.all(todas.map(({ sessao }) => sessao.encerrar().catch(() => {})));
  }
}
