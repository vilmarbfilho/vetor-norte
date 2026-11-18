// Read-only views over what the API recorded: error logs, PDF download history, protocol query history.

import type { FastifyInstance } from 'fastify';
import type { FiltrosConsultas, FiltrosDownloads, FiltrosLogs, RepositorioMonitoramento } from '../repositories/types.ts';
import { hashCpf } from '../utils/cpf-hash.ts';

const DATA_HORA = { type: 'string', format: 'date-time' } as const;
const UUID = { type: 'string', format: 'uuid' } as const;
const PAGINACAO = {
  pagina: { type: 'integer', minimum: 1, default: 1 },
  porPagina: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
} as const;

/** `chaveHmacCpf` = CPF_HMAC_CHAVE, the same key the API uses to hash CPFs in the query history. */
export function rotasMonitoramento(app: FastifyInstance, monitoramento: RepositorioMonitoramento, chaveHmacCpf: string): void {
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

  app.get<{ Querystring: Omit<FiltrosConsultas, 'cpfHash'> & { cpf?: string } }>(
    '/api/consultas',
    {
      schema: {
        querystring: {
          type: 'object', additionalProperties: false,
          properties: {
            ...PAGINACAO, de: DATA_HORA, ate: DATA_HORA,
            // Full CPF, formatted or not. Only its HMAC reaches the database query; console and error logs
            // mask CPFs in URLs (app.ts serializers, textoSeguro).
            cpf: { type: 'string', pattern: '^\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}$' },
            protocolo: { type: 'string', pattern: '^\\d{1,20}$' },
            resultado: { type: 'string', enum: ['ok', 'erro'] },
            apiKeyId: UUID,
          },
        },
      },
    },
    async (req) => {
      const { cpf, ...filtros } = req.query;
      return monitoramento.listarConsultas({ ...filtros, ...(cpf ? { cpfHash: hashCpf(cpf, chaveHmacCpf) } : {}) });
    },
  );
}
