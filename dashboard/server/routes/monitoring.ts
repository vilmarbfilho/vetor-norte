// Read-only views over what the API recorded: error logs and PDF download history.

import type { FastifyInstance } from 'fastify';
import type { FiltrosDownloads, FiltrosLogs, RepositorioMonitoramento } from '../repositories/types.ts';

const DATA_HORA = { type: 'string', format: 'date-time' } as const;
const UUID = { type: 'string', format: 'uuid' } as const;
const PAGINACAO = {
  pagina: { type: 'integer', minimum: 1, default: 1 },
  porPagina: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
} as const;

export function rotasMonitoramento(app: FastifyInstance, monitoramento: RepositorioMonitoramento): void {
  app.get<{ Querystring: FiltrosLogs }>(
    '/api/logs',
    {
      schema: {
        querystring: {
          type: 'object', additionalProperties: false,
          properties: {
            ...PAGINACAO, de: DATA_HORA, ate: DATA_HORA,
            origem: { type: 'string', enum: ['api', 'dashboard'] },
            status: { type: 'integer', minimum: 100, maximum: 599 },
            busca: { type: 'string', minLength: 1, maxLength: 100 },
            apiKeyId: UUID,
          },
        },
      },
    },
    async (req) => monitoramento.listarLogs(req.query),
  );

  app.get<{ Params: { id: string } }>(
    '/api/logs/:id',
    { schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^\\d{1,18}$' } } } } },
    async (req, reply) => {
      const log = await monitoramento.obterLog(req.params.id);
      if (!log) return reply.status(404).send({ erro: 'Log não encontrado', codigo: 'nao_encontrado' });
      return log;
    },
  );

  app.get<{ Querystring: FiltrosDownloads }>(
    '/api/downloads',
    {
      schema: {
        querystring: {
          type: 'object', additionalProperties: false,
          properties: {
            ...PAGINACAO, de: DATA_HORA, ate: DATA_HORA,
            protocolo: { type: 'string', pattern: '^\\d{1,20}$' },
            tipo: { type: 'string', enum: ['binario', 'base64', 'envio'] },
            resultado: { type: 'string', enum: ['ok', 'nao_encontrado', 'sem_pdf', 'erro'] },
            apiKeyId: UUID,
          },
        },
      },
    },
    async (req) => monitoramento.listarDownloads(req.query),
  );
}
