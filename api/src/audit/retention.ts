// LGPD retention: deletes old error logs and download history.
// Runs at startup and then once a day, inside the API (the only writer of these tables).

import type { Sql } from 'postgres';

export interface ConfigRetencao {
  /** RETENCAO_LOGS_DIAS */
  logsDias: number;
  /** RETENCAO_DOWNLOADS_DIAS */
  downloadsDias: number;
}

const UM_DIA_MS = 24 * 60 * 60 * 1000;

export async function purgarAntigos(sql: Sql, cfg: ConfigRetencao): Promise<{ logs: number; downloads: number }> {
  const logs = await sql`DELETE FROM logs_erro WHERE ocorrido_em < now() - make_interval(days => ${cfg.logsDias})`;
  const downloads = await sql`
    DELETE FROM downloads_pdf WHERE ocorrido_em < now() - make_interval(days => ${cfg.downloadsDias})
  `;
  return { logs: logs.count, downloads: downloads.count };
}

/** Starts the daily purge. Returns a function that stops it (used on shutdown). */
export function agendarRetencao(sql: Sql, cfg: ConfigRetencao): () => void {
  const executar = () =>
    purgarAntigos(sql, cfg)
      .then(({ logs, downloads }) => {
        if (logs || downloads) console.log(`[retencao] removidos: ${logs} log(s) de erro, ${downloads} download(s)`);
      })
      .catch((e: Error) => console.warn(`[retencao] falha na limpeza: ${e.message}`));
  void executar();
  const timer = setInterval(executar, UM_DIA_MS);
  timer.unref(); // never keeps the process alive on its own
  return () => clearInterval(timer);
}
