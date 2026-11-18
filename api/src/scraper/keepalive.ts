// Portal session keep-alive (KEEPALIVE_HABILITADO). While the API is idle, it periodically does a light
// navigation in the Broker so the portal session does not expire, and so problems (portal down,
// password changed) show up in the error log before a client request hits them.
// Requests already keep the session alive, so the check is skipped when there was recent activity.

import { mascararCpf } from '../audit/mask.ts';

export interface SessaoVerificavel {
  ociosaHaMs(agora?: number): number;
  verificar(): Promise<void>;
}

export interface OpcoesKeepAlive {
  intervaloMs: number;
  /** Called when the check failed even after a re-login (e.g. to write the error log). */
  aoFalhar(erro: Error): void;
  agora?: () => number;
}

export class KeepAlive {
  private timer?: NodeJS.Timeout;
  private executando = false;
  private readonly agora: () => number;

  constructor(private readonly sessao: SessaoVerificavel, private readonly opcoes: OpcoesKeepAlive) {
    this.agora = opcoes.agora ?? Date.now;
  }

  iniciar(): void {
    this.timer = setInterval(() => void this.tick(), this.opcoes.intervaloMs);
    this.timer.unref(); // never keeps the process alive on its own
  }

  parar(): void {
    clearInterval(this.timer);
  }

  /** One timer tick. Public for tests. Returns whether a check was run. */
  async tick(): Promise<boolean> {
    if (this.executando) return false; // previous check still running (e.g. slow re-login)
    if (this.sessao.ociosaHaMs(this.agora()) < this.opcoes.intervaloMs) return false;
    this.executando = true;
    try {
      await this.sessao.verificar();
    } catch (e) {
      console.warn(`[keepalive] verificação da sessão falhou: ${mascararCpf((e as Error).message.split('\n')[0]!)}`);
      this.opcoes.aoFalhar(e as Error);
    } finally {
      this.executando = false;
    }
    return true;
  }
}
