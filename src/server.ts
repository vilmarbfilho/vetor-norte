// API entry point: wires session + service + routes and starts the server.

import { criarApp } from './api/app.ts';
import { config } from './config/env.ts';
import { SessaoBroker } from './scraper/session.ts';
import { ServicoProtocolosBroker } from './services/protocols.ts';

const sessao = new SessaoBroker(config);
const app = criarApp(new ServicoProtocolosBroker(sessao), { logger: true });

await app.listen({ port: config.porta, host: config.host });

// Log in at startup so the first request doesn't pay that cost.
// If it fails here, the first request tries again.
sessao.iniciar().catch((e) => app.log.warn(`Login inicial falhou: ${(e as Error).message}`));

let desligando = false;
async function desligar(sinal: string) {
  if (desligando) return; // ignore repeated signals (e.g. Ctrl+C twice)
  desligando = true;
  app.log.info(`${sinal} recebido, encerrando`);
  await app.close();
  await sessao.encerrar();
  process.exit(0);
}
process.on('SIGINT', () => void desligar('SIGINT'));
process.on('SIGTERM', () => void desligar('SIGTERM'));
