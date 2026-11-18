// One Chromium shared by every user's session (each user gets its own isolated context).

import { chromium, type Browser } from 'playwright';

export class Navegador {
  private browser?: Browser;
  private abrindo?: Promise<Browser>;

  constructor(private readonly headless: boolean) {}

  /** Returns the running browser, (re)launching it if needed. Concurrent callers share one launch. */
  obter(): Promise<Browser> {
    if (this.browser?.isConnected()) return Promise.resolve(this.browser);
    this.abrindo ??= chromium
      .launch({ headless: this.headless })
      .then((b) => (this.browser = b))
      .finally(() => (this.abrindo = undefined));
    return this.abrindo;
  }

  async fechar(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
  }
}
