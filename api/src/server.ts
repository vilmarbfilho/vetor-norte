// API entry point: wires per-user portal sessions + service + routes and starts the server.

import { criarApp } from './api/app.ts';
import { chaveHmacCpf } from './audit/cpf-hash.ts';
import { AuditoriaPg } from './audit/recorder.ts';
import { agendarRetencao } from './audit/retention.ts';
import { RepositorioChavesPg } from './auth/repository.ts';
import { config, obrigatoria } from './config/env.ts';
import { chaveCredenciais } from './credentials/crypto.ts';
import { RepositorioCredenciaisPg } from './credentials/repository.ts';
import { conectarBanco } from './db/client.ts';
import { destinosDoAmbiente } from './delivery/registry.ts';
import { Navegador } from './scraper/browser.ts';
import { SessaoBroker, type Recursos } from './scraper/session.ts';
import { GerenciadorSessoes } from './scraper/sessions.ts';
import { ServicoProtocolosBroker } from './services/protocols.ts';

// Required here (not in config) so the scraper CLI keeps working without a database.
const sql = conectarBanco(obrigatoria('DATABASE_URL'));
const destinos = destinosDoAmbiente(process.env);
const navegador = new Navegador(config.headless);
let contadorSessoes = 0;
const sessoes = new GerenciadorSessoes<Recursos>({
  repositorio: new RepositorioCredenciaisPg(sql),
  chave: chaveCredenciais(process.env.CREDENCIAIS_CHAVE),
  ociosaMs: config.sessoes.ociosaMs,
  max: config.sessoes.max,
  criarSessao: ({ email, senha, aoLogar }) =>
    // The label is a counter: console logs never show the user's e-mail.
    new SessaoBroker({ portalUrl: config.portalUrl, email, senha, aoLogar, navegador: () => navegador.obter(), rotulo: `#${++contadorSessoes}` }),
});
const auditoria = new AuditoriaPg(sql, chaveHmacCpf(process.env.CPF_HMAC_CHAVE));
const app = criarApp(new ServicoProtocolosBroker(sessoes), {
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
  await sql`SELECT 1 FROM api_keys, credenciais_portal LIMIT 1`;
} catch (e) {
  app.log.error(`Banco de dados indisponível ou sem migrations: ${(e as Error).message}`);
  await sql.end({ timeout: 1 });
  process.exit(1);
}

await app.listen({ port: config.porta, host: config.host });

app.log.info(`Retenção: logs de erro ${config.retencao.logsDias} dias, downloads ${config.retencao.downloadsDias} dias, consultas ${config.retencao.consultasDias} dias`);
const pararRetencao = agendarRetencao(sql, config.retencao);

// Sessions open on a user's first request (with their own credentials) and close when idle.
sessoes.iniciarLimpeza();
app.log.info(`Sessões do portal: uma por usuário, encerrada após ${config.sessoes.ociosaMs / 60_000} min ociosa, no máximo ${config.sessoes.max}`);

let desligando = false;
async function desligar(sinal: string) {
  if (desligando) return; // ignore repeated signals (e.g. Ctrl+C twice)
  desligando = true;
  app.log.info(`${sinal} recebido, encerrando`);
  pararRetencao();
  await app.close();
  await sessoes.encerrarTodas();
  await navegador.fechar();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on('SIGINT', () => void desligar('SIGINT'));
process.on('SIGTERM', () => void desligar('SIGTERM'));
