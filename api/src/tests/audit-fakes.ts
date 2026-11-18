// In-memory audit recorder for HTTP tests (no database).
import type { Auditoria, RegistroDownload, RegistroErro } from '../audit/recorder.ts';

export class AuditoriaFake implements Auditoria {
  readonly erros: RegistroErro[] = [];
  readonly downloads: RegistroDownload[] = [];

  erro(r: RegistroErro): void {
    this.erros.push(r);
  }

  download(r: RegistroDownload): void {
    this.downloads.push(r);
  }

  limpar(): void {
    this.erros.length = 0;
    this.downloads.length = 0;
  }
}
