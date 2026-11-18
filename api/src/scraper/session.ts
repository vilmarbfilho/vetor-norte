// Persistent Broker session: one logged-in browser reused across requests.
//
// - Login and opening the Broker (~7s) happen once, not on every query.
// - Operations run in a QUEUE (one at a time), because they all share the same tab.
// - If an operation fails (expired session, browser crash, timeout), the session is
//   discarded, rebuilt from scratch, and the operation is retried ONCE.

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mascararCpf } from '../audit/mask.ts';
import { abrirBroker, login, prepararContexto, verificarSessao } from './portal.ts';

const log = (msg: string) => console.log(`[sessao] ${msg}`);

export interface ConfigSessao {
  portalUrl: string;
  email: string;
  senha: string;
  headless: boolean;
}

export interface Recursos {
  broker: Page;
  context: BrowserContext;
}

export class SessaoBroker {
  private browser?: Browser;
  private context?: BrowserContext;
  private broker?: Page;
  private abrindo?: Promise<void>;
  private fila: Promise<unknown> = Promise.resolve();
  private abertaEm?: Date;
  private ultimaAtividade = 0;

  constructor(private readonly cfg: ConfigSessao) {}

  get status() {
    return {
      ativa: this.ativa,
      abertaEm: this.abertaEm?.toISOString() ?? null,
      ultimaAtividadeEm: this.ultimaAtividade ? new Date(this.ultimaAtividade).toISOString() : null,
    };
  }

  private get ativa(): boolean {
    return Boolean(this.browser?.isConnected() && this.broker && !this.broker.isClosed());
  }

  /** Ensures a logged-in session. Concurrent callers await the same login. */
  async iniciar(): Promise<void> {
    if (this.ativa) return;
    this.abrindo ??= this.abrir().finally(() => (this.abrindo = undefined));
    return this.abrindo;
  }

  private async abrir(): Promise<void> {
    const inicio = Date.now();
    log('Abrindo nova sessão');
    if (!this.browser?.isConnected()) {
      this.browser = await chromium.launch({ headless: this.cfg.headless });
    }
    await this.descartarSessao();

    const context = await this.browser.newContext();
    await prepararContexto(context);
    const page = await context.newPage();
    await login(page, this.cfg.portalUrl, this.cfg.email, this.cfg.senha);
    this.broker = await abrirBroker(page);
    this.context = context;
    this.abertaEm = new Date();
    this.ultimaAtividade = Date.now(); // a fresh login counts as activity for the keep-alive
    log(`Sessão pronta em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
  }

  /**
   * Runs an operation with the logged-in session, queued.
   * Technical errors trigger 1 retry with a fresh session.
   */
  executar<T>(operacao: (r: Recursos) => Promise<T>): Promise<T> {
    const tarefa = this.fila.then(() => this.comRetentativa(operacao));
    this.fila = tarefa.catch(() => {}); // a failure must not block the queue
    return tarefa;
  }

  /** Milliseconds since the last successful operation (Infinity if none yet). Used by the keep-alive. */
  ociosaHaMs(agora = Date.now()): number {
    return this.ultimaAtividade ? agora - this.ultimaAtividade : Infinity;
  }

  /**
   * Keep-alive step: light navigation through the normal queue (never in parallel with a request).
   * If the session expired (or was never opened), the retry logs in again, so the next request is fast.
   */
  verificar(): Promise<void> {
    return this.executar(({ broker }) => verificarSessao(broker));
  }

  private async comRetentativa<T>(operacao: (r: Recursos) => Promise<T>): Promise<T> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        await this.iniciar();
        const resultado = await operacao({ broker: this.broker!, context: this.context! });
        this.ultimaAtividade = Date.now();
        return resultado;
      } catch (erro) {
        if (tentativa >= 2) throw erro;
        log(`Falha na operação (${mascararCpf((erro as Error).message.split('\n')[0]!)}). Refazendo sessão e tentando de novo.`);
        await this.descartarSessao();
      }
    }
  }

  private async descartarSessao(): Promise<void> {
    await this.context?.close().catch(() => {});
    this.context = undefined;
    this.broker = undefined;
    this.abertaEm = undefined;
  }

  async encerrar(): Promise<void> {
    await this.descartarSessao();
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
  }
}
