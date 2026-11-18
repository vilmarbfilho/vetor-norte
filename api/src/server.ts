// API entry point: wires session + service + routes and starts the server.

import { criarApp } from './api/app.ts';
import { chaveHmacCpf } from './audit/cpf-hash.ts';
import { AuditoriaPg } from './audit/recorder.ts';
import { agendarRetencao } from './audit/retention.ts';
import { RepositorioChavesPg } from './auth/repository.ts';
import { config, obrigatoria } from './config/env.ts';
import { conectarBanco } from './db/client.ts';
import { destinosDoAmbiente } from './delivery/registry.ts';
import { KeepAlive } from './scraper/keepalive.ts';
import { SessaoBroker } from './scraper/session.ts';
import { ServicoProtocolosBroker } from './services/protocols.ts';

// Required here (not in config) so the scraper CLI keeps working without a database.
const sql = conectarBanco(obrigatoria('DATABASE_URL'));
const destinos = destinosDoAmbiente(process.env);
const sessao = new SessaoBroker(config);
const auditoria = new AuditoriaPg(sql, chaveHmacCpf(process.env.CPF_HMAC_CHAVE));
const app = criarApp(new ServicoProtocolosBroker(sessao), {
  logger: true,
  destinos,
  autenticacao: { repositorio: new RepositorioChavesPg(sql), rateLimit: config.rateLimit },
  auditoria,
  prefixoPublico: config.prefixoPublico,
});
app.log.info(`Destinos de entrega: ${[...destinos.keys()].join(', ') || 'nenhum'}`);
app.log.info(
  config.rateLimit.habilitado
    ? `Rate limit: ${config.rateLimit.porMinutoPadrao} req/min por chave (padrão)`
    : 'Rate limit: desabilitado',
);

// Fail at startup (not on the first request) if the database is unreachable or not migrated.
try {
  await sql`SELECT 1 FROM api_keys LIMIT 1`;
} catch (e) {
  app.log.error(`Banco de dados indisponível ou sem migrations: ${(e as Error).message}`);
  await sql.end({ timeout: 1 });
  process.exit(1);
}

await app.listen({ port: config.porta, host: config.host });

app.log.info(`Retenção: logs de erro ${config.retencao.logsDias} dias, downloads ${config.retencao.downloadsDias} dias, consultas ${config.retencao.consultasDias} dias`);
const pararRetencao = agendarRetencao(sql, config.retencao);

// Log in at startup so the first request doesn't pay that cost.
// If it fails here, the first request tries again.
sessao.iniciar().catch((e) => app.log.warn(`Login inicial falhou: ${(e as Error).message}`));

// Keeps the portal session alive while idle; a failure (after one re-login) goes to the error log.
const keepAlive = new KeepAlive(sessao, {
  intervaloMs: config.keepAlive.intervaloMs,
  aoFalhar: (erro) =>
    auditoria.erro({
      metodo: null, rota: null, statusHttp: null,
      mensagem: `Keep-alive da sessão do portal falhou: ${erro.message}`,
      detalhes: { tipo: erro.name, origem: 'keepalive', stack: erro.stack ?? '' },
    }),
});
if (config.keepAlive.habilitado) {
  keepAlive.iniciar();
  app.log.info(`Keep-alive: verifica a sessão após ${config.keepAlive.intervaloMs / 60_000} min sem atividade`);
} else {
  app.log.info('Keep-alive: desabilitado');
}

let desligando = false;
async function desligar(sinal: string) {
  if (desligando) return; // ignore repeated signals (e.g. Ctrl+C twice)
  desligando = true;
  app.log.info(`${sinal} recebido, encerrando`);
  pararRetencao();
  keepAlive.parar();
  await app.close();
  await sessao.encerrar();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on('SIGINT', () => void desligar('SIGINT'));
process.on('SIGTERM', () => void desligar('SIGTERM'));
