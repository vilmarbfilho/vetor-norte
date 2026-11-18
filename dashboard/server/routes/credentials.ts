// Broker portal credentials: every user manages their own; admins also manage anyone's.
// The password is encrypted here (credentials-crypto.ts) and never returned. Saving resets the status
// to 'nao_testada'; the API marks it 'valida' or 'invalida' when it logs in to the portal (stage 17).
// No dashboard password confirmation and no removal (decided with the owner).

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { RepositorioCredenciais } from '../repositories/types.ts';
import { cifrarSenha } from '../utils/credentials-crypto.ts';

interface Corpo { emailPortal: string; senha: string }

const CORPO = {
  type: 'object', required: ['emailPortal', 'senha'], additionalProperties: false,
  properties: {
    emailPortal: { type: 'string', minLength: 3, maxLength: 200, pattern: '^\\s*[^\\s@]+@[^\\s@]+\\.[^\\s@]+\\s*$' },
    // Not trimmed: spaces may be part of the portal password.
    senha: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

export function rotasCredenciais(app: FastifyInstance, credenciais: RepositorioCredenciais, chave: Buffer): void {
  async function salvar(reply: FastifyReply, usuarioId: string, corpo: Corpo, atualizadaPor: string) {
    const credencial = await credenciais.salvar({
      usuarioId, emailPortal: corpo.emailPortal.trim(), senhaCifrada: cifrarSenha(corpo.senha, chave, usuarioId), atualizadaPor,
    });
    if (!credencial) return reply.status(404).send({ erro: 'Usuário não encontrado', codigo: 'nao_encontrado' });
    return { credencial };
  }

  app.get('/api/credenciais', { config: { acesso: 'todos' } }, async (req) => ({
    credencial: await credenciais.obter(req.usuario!.id),
  }));

  app.put<{ Body: Corpo }>(
    '/api/credenciais',
    { schema: { body: CORPO }, config: { acesso: 'todos' } },
    async (req, reply) => salvar(reply, req.usuario!.id, req.body, req.usuario!.id),
  );

  app.put<{ Params: { id: string }; Body: Corpo }>(
    '/api/usuarios/:id/credenciais',
    {
      schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } }, body: CORPO },
      config: { acesso: 'admin' },
    },
    async (req, reply) => salvar(reply, req.params.id, req.body, req.usuario!.id),
  );
}
