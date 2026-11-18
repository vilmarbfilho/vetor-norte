// API keys: list, create (full key returned ONCE), edit, revoke.
// The API caches key lookups for 10 s, so changes and revocations take effect within ~10 s.

import type { FastifyInstance, FastifyReply } from 'fastify';
import { gerarChaveApi, PERMISSOES, type Permissao } from '../auth/api-keys.ts';
import type { AlteracaoChave, RepositorioChaves, ResultadoAlteracaoChave } from '../repositories/types.ts';

const NOME = { type: 'string', minLength: 1, maxLength: 100 } as const;
const PERMISSOES_SCHEMA = {
  type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: [...PERMISSOES] },
} as const;
const LIMITE = { type: ['integer', 'null'], minimum: 1, maximum: 10_000 } as const;
const PARAMS_ID = { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } as const;

function responder(reply: FastifyReply, r: ResultadoAlteracaoChave) {
  switch (r.tipo) {
    case 'nao_encontrada':
      return reply.status(404).send({ erro: 'Chave não encontrada', codigo: 'nao_encontrado' });
    case 'revogada':
      return reply.status(409).send({ erro: 'A chave já foi revogada e não pode ser alterada', codigo: 'chave_revogada' });
    case 'ok':
      return { chave: r.chave };
  }
}

export function rotasChaves(app: FastifyInstance, chaves: RepositorioChaves): void {
  app.get('/api/chaves', async () => ({ chaves: await chaves.listar(), permissoesDisponiveis: PERMISSOES }));

  app.post<{ Body: { nome: string; permissoes: Permissao[]; limitePorMinuto?: number | null } }>(
    '/api/chaves',
    {
      schema: {
        body: {
          type: 'object', required: ['nome', 'permissoes'], additionalProperties: false,
          properties: { nome: NOME, permissoes: PERMISSOES_SCHEMA, limitePorMinuto: LIMITE },
        },
      },
    },
    async (req, reply) => {
      const { chave: segredo, prefixo, hash } = gerarChaveApi();
      const chave = await chaves.criar({
        nome: req.body.nome.trim(), prefixo, hash, permissoes: req.body.permissoes,
        limitePorMinuto: req.body.limitePorMinuto ?? null, criadoPor: req.usuario!.id,
      });
      // The only time the full key leaves the server. It is not stored anywhere.
      return reply.status(201).header('Cache-Control', 'no-store').send({ chave, segredo });
    },
  );

  app.patch<{ Params: { id: string }; Body: AlteracaoChave }>(
    '/api/chaves/:id',
    {
      schema: {
        params: PARAMS_ID,
        body: {
          type: 'object', additionalProperties: false, minProperties: 1,
          properties: { nome: NOME, permissoes: PERMISSOES_SCHEMA, limitePorMinuto: LIMITE },
        },
      },
    },
    async (req, reply) => {
      const alteracao = { ...req.body, ...(req.body.nome !== undefined ? { nome: req.body.nome.trim() } : {}) };
      return responder(reply, await chaves.alterar(req.params.id, alteracao));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/chaves/:id/revogar',
    { schema: { params: PARAMS_ID } },
    async (req, reply) => responder(reply, await chaves.revogar(req.params.id, req.usuario!.id)),
  );
}
