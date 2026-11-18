// Brute-force protection: after N wrong passwords for the same e-mail, login for that e-mail is
// blocked for a while. In memory: the dashboard runs as a single instance (resets on restart).

export class BloqueioLogin {
  private falhas = new Map<string, { contagem: number; primeiraEm: number; bloqueadoAte: number }>();

  constructor(
    private readonly maxTentativas: number,
    private readonly bloqueioMs: number,
    private readonly agora: () => number = Date.now,
  ) {}

  private chave(email: string): string {
    return email.trim().toLowerCase();
  }

  /** Milliseconds left in the block (0 = not blocked). */
  bloqueadoPor(email: string): number {
    const f = this.falhas.get(this.chave(email));
    return f ? Math.max(0, f.bloqueadoAte - this.agora()) : 0;
  }

  registrarFalha(email: string): void {
    const k = this.chave(email);
    const agora = this.agora();
    let f = this.falhas.get(k);
    // Start a fresh streak when the old one is outside the window or its block has already expired.
    const expirada = f && (agora - f.primeiraEm > this.bloqueioMs || (f.bloqueadoAte > 0 && agora >= f.bloqueadoAte));
    if (!f || expirada) f = { contagem: 0, primeiraEm: agora, bloqueadoAte: 0 };
    f.contagem++;
    if (f.contagem >= this.maxTentativas) f.bloqueadoAte = agora + this.bloqueioMs;
    this.falhas.set(k, f);
    if (this.falhas.size > 10_000) this.falhas.clear(); // bounded memory under a flood of random e-mails
  }

  registrarSucesso(email: string): void {
    this.falhas.delete(this.chave(email));
  }
}
