// One user's persistent Broker session: a logged-in browser context reused across that user's requests.
//
// - Login and opening the Broker (~7s) happen once, not on every query.
// - Operations run in a QUEUE (one at a time), because they all share the same tab.
// - If an operation fails (expired session, browser crash, timeout), the context is
//   discarded, rebuilt from scratch, and the operation is retried ONCE.
// - If the portal REFUSES the login (ErroLoginRecusado), there is no retry, and the session never tries
//   to log in again: repeated attempts with a bad password could lock the user's portal account.

import type { Browser, BrowserContext, Page } from 'playwright';
import { mascararCpf } from '../audit/mask.ts';
import { abrirBroker, ErroLoginRecusado, login, prepararContexto } from './portal.ts';

export interface ConfigSessao {
  portalUrl: string;
  email: string;
  senha: string;
  /** Shared browser (see browser.ts). */
  navegador: () => Promise<Browser>;
  /** Called after every successful portal login. */
  aoLogar?: () => void;
  /** Shown in console logs (never the e-mail or the password). */
  rotulo?: string;
}

export interface Recursos {
  broker: Page;
  context: BrowserContext;
}

export class SessaoBroker {
  private context?: BrowserContext;
  private broker?: Page;
  private abrindo?: Promise<void>;
  private fila: Promise<unknown> = Promise.resolve();
  private pendentes = 0;
  private ultimaAtividade = Date.now();
  private recusada?: ErroLoginRecusado;
  private encerrada = false;

  constructor(private readonly cfg: ConfigSessao) {}

  private log(msg: string) {
    console.log(`[sessao${this.cfg.rotulo ? ` ${this.cfg.rotulo}` : ''}] ${msg}`);
  }

  private get ativa(): boolean {
    return Boolean(this.context?.browser()?.isConnected() && this.broker && !this.broker.isClosed());
  }

  /** True while an operation is running or queued. */
  get ocupada(): boolean {
    return this.pendentes > 0;
  }

  /** Milliseconds since the last operation finished (or since the session was created). */
  ociosaHaMs(agora = Date.now()): number {
    return agora - this.ultimaAtividade;
  }

  /** Ensures a logged-in context. Concurrent callers await the same login. */
  private async iniciar(): Promise<void> {
    if (this.recusada) throw this.recusada;
    if (this.encerrada) throw new Error('Sessão do portal encerrada');
    if (this.ativa) return;
    this.abrindo ??= this.abrir().finally(() => (this.abrindo = undefined));
    return this.abrindo;
  }

  private async abrir(): Promise<void> {
    const inicio = Date.now();
    this.log('Abrindo nova sessão');
    await this.descartarContexto();
    const context = await (await this.cfg.navegador()).newContext();
    try {
      await prepararContexto(context);
      const page = await context.newPage();
      await login(page, this.cfg.portalUrl, this.cfg.email, this.cfg.senha);
      this.cfg.aoLogar?.();
      this.broker = await abrirBroker(page);
      this.context = context;
    } catch (e) {
      await context.close().catch(() => {});
      throw e;
    }
    this.log(`Sessão pronta em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
  }

  /**
   * Runs an operation with the logged-in session, queued.
   * Technical errors trigger 1 retry with a fresh context; a refused login does not.
   */
  executar<T>(operacao: (r: Recursos) => Promise<T>): Promise<T> {
    this.pendentes++;
    const tarefa = this.fila.then(() => this.comRetentativa(operacao)).finally(() => {
      this.pendentes--;
      this.ultimaAtividade = Date.now();
    });
    this.fila = tarefa.catch(() => {}); // a failure must not block the queue
    return tarefa;
  }

  private async comRetentativa<T>(operacao: (r: Recursos) => Promise<T>): Promise<T> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        await this.iniciar();
        return await operacao({ broker: this.broker!, context: this.context! });
      } catch (erro) {
        if (erro instanceof ErroLoginRecusado) {
          this.recusada = erro;
          await this.descartarContexto();
          throw erro;
        }
        if (tentativa >= 2 || this.encerrada) throw erro;
        this.log(`Falha na operação (${mascararCpf((erro as Error).message.split('\n')[0]!)}). Refazendo sessão e tentando de novo.`);
        await this.descartarContexto();
      }
    }
  }

  private async descartarContexto(): Promise<void> {
    await this.context?.close().catch(() => {});
    this.context = undefined;
    this.broker = undefined;
  }

  /** Closes this user's context (the shared browser stays open). */
  async encerrar(): Promise<void> {
    this.encerrada = true;
    await this.descartarContexto();
  }
}
