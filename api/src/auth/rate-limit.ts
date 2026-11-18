// In-memory rate limiter: fixed one-minute window per API key.
// In memory is enough because the API runs as a single instance (one portal session).
// Counters reset when the API restarts.

export interface ResultadoLimite {
  permitido: boolean;
  limite: number;
  restantes: number;
  /** Seconds until the current window ends (used for Retry-After). */
  reiniciaEmSegundos: number;
}

const JANELA_MS = 60_000;

export class LimitadorPorMinuto {
  private janelas = new Map<string, { inicio: number; contagem: number }>();

  /** `agora` is injectable so tests don't depend on the clock. */
  constructor(private readonly agora: () => number = Date.now) {}

  /** Counts one request for `chaveId` and says whether it is within `limite` per minute. */
  consumir(chaveId: string, limite: number): ResultadoLimite {
    const agora = this.agora();
    let janela = this.janelas.get(chaveId);
    if (!janela || agora - janela.inicio >= JANELA_MS) {
      janela = { inicio: agora, contagem: 0 };
      this.janelas.set(chaveId, janela);
    }
    const reiniciaEmSegundos = Math.max(1, Math.ceil((janela.inicio + JANELA_MS - agora) / 1000));
    if (janela.contagem >= limite) {
      return { permitido: false, limite, restantes: 0, reiniciaEmSegundos };
    }
    janela.contagem++;
    return { permitido: true, limite, restantes: limite - janela.contagem, reiniciaEmSegundos };
  }
}
