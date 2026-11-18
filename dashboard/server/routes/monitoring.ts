// Read-only views over what the API recorded: error logs, PDF download history, protocol query history.
// Errors: admins only. Downloads and queries: admins see everything (optional `usuarioId` filter);
// a corretor with the screen granted sees only their own rows (`usuarioId` is forced to them).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ehAdmin } from '../auth/access.ts';
import type { FiltrosConsultas, FiltrosDownloads, FiltrosLogs, RepositorioMonitoramento } from '../repositories/types.ts';
import { hashCpf } from '../utils/cpf-hash.ts';

const DATA_HORA = { type: 'string', format: 'date-time' } as const;
const UUID = { type: 'string', format: 'uuid' } as const;
const PAGINACAO = {
  pagina: { type: 'integer', minimum: 1, default: 1 },
  porPagina: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
} as const;

/** Owner filter: admins choose (or not); corretores always get their own id. */
function donoDaListagem(req: FastifyRequest, pedido: string | undefined): { usuarioId?: string } {
  const usuario = req.usuario!;
  if (!ehAdmin(usuario)) return { usuarioId: usuario.id };
  return pedido ? { usuarioId: pedido } : {};
}

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
            apiKeyId: UUID, usuarioId: UUID,
          },
        },
      },
      config: { acesso: 'admin' },
    },
    async (req) => monitoramento.listarLogs(req.query),
  );

  app.get<{ Params: { id: string } }>(
    '/api/logs/:id',
    {
      schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^\\d{1,18}$' } } } },
      config: { acesso: 'admin' },
    },
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
            apiKeyId: UUID, usuarioId: UUID,
          },
        },
      },
      config: { acesso: 'downloads' },
    },
    async (req) => monitoramento.listarDownloads({ ...req.query, ...donoDaListagem(req, req.query.usuarioId) }),
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
            apiKeyId: UUID, usuarioId: UUID,
          },
        },
      },
      config: { acesso: 'consultas' },
    },
    async (req) => {
      const { cpf, ...filtros } = req.query;
      return monitoramento.listarConsultas({
        ...filtros, ...donoDaListagem(req, filtros.usuarioId), ...(cpf ? { cpfHash: hashCpf(cpf, chaveHmacCpf) } : {}),
      });
    },
  );
}
