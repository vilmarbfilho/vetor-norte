// Dashboard entry point: database + repositories + HTTP server.

import { fileURLToPath } from 'node:url';
import { criarApp } from './app.ts';
import { chaveHmacCpf } from './utils/cpf-hash.ts';
import { config } from './config/env.ts';
import { conectarBanco } from './db/client.ts';
import { RepositorioContasPg } from './repositories/accounts.ts';
import { RepositorioChavesPg } from './repositories/keys.ts';
import { RepositorioMonitoramentoPg } from './repositories/monitoring.ts';

const sql = conectarBanco(config.databaseUrl);
const contas = new RepositorioContasPg(sql);
const app = criarApp({
  repositorios: { contas, monitoramento: new RepositorioMonitoramentoPg(sql), chaves: new RepositorioChavesPg(sql) },
  sessao: config.sessao,
  login: config.login,
  chaveHmacCpf: chaveHmacCpf(process.env.CPF_HMAC_CHAVE),
  logger: true,
  // Built by `npm run build` (vite) into dashboard/web/dist.
  pastaWeb: fileURLToPath(new URL('../web/dist', import.meta.url)),
});

try {
  await sql`SELECT 1 FROM sessoes LIMIT 1`;
} catch (e) {
  app.log.error(`Banco de dados indisponível ou sem migrations: ${(e as Error).message}`);
  await sql.end({ timeout: 1 });
  process.exit(1);
}

await app.listen({ port: config.porta, host: config.host });
if (!config.sessao.cookieSeguro) app.log.warn('COOKIE_SECURE=false: use apenas em desenvolvimento local (http).');

// Expired sessions are useless; delete them at startup and once a day.
const limparSessoes = () =>
  contas
    .purgarSessoesExpiradas(config.sessao.inatividadeMs)
    .then((n) => n && app.log.info(`Sessões expiradas removidas: ${n}`))
    .catch((e: Error) => app.log.warn(`Falha ao limpar sessões: ${e.message}`));
void limparSessoes();
const timer = setInterval(limparSessoes, 86_400_000);
timer.unref();

let desligando = false;
async function desligar(sinal: string) {
  if (desligando) return;
  desligando = true;
  app.log.info(`${sinal} recebido, encerrando`);
  clearInterval(timer);
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on('SIGINT', () => void desligar('SIGINT'));
process.on('SIGTERM', () => void desligar('SIGTERM'));
