// API keys: list, create (full key returned ONCE), edit, revoke.
// The API caches key lookups for 10 s, so changes and revocations take effect within ~10 s.
//
// Ownership: every key belongs to a user (the API uses that user's ceiling and portal credentials).
// - admin: sees and manages every key; may create a key for any active user; sets rate limits.
// - corretor (screen "chaves" granted): only their own keys, permissions within their ceiling, and no
//   rate limit changes (keys created by them use the global default).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ehAdmin, permissoesForaDoTeto, tetoPermissoes } from '../auth/access.ts';
import { gerarChaveApi, PERMISSOES, type Permissao } from '../auth/api-keys.ts';
import type {
  AlteracaoChave, ChaveApiResumo, RepositorioChaves, RepositorioUsuarios, ResultadoAlteracaoChave, Usuario,
} from '../repositories/types.ts';

const NOME = { type: 'string', minLength: 1, maxLength: 100 } as const;
const PERMISSOES_SCHEMA = {
  type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: [...PERMISSOES] },
} as const;
const LIMITE = { type: ['integer', 'null'], minimum: 1, maximum: 10_000 } as const;
const UUID = { type: 'string', format: 'uuid' } as const;
const PARAMS_ID = { type: 'object', properties: { id: UUID } } as const;
const ACESSO = { acesso: 'chaves' } as const;

function responder(reply: FastifyReply, r: ResultadoAlteracaoChave) {
  switch (r.tipo) {
    case 'nao_encontrada':
      return naoEncontrada(reply);
    case 'revogada':
      return reply.status(409).send({ erro: 'A chave já foi revogada e não pode ser alterada', codigo: 'chave_revogada' });
    case 'ok':
      return { chave: r.chave };
  }
}

const naoEncontrada = (reply: FastifyReply) =>
  reply.status(404).send({ erro: 'Chave não encontrada', codigo: 'nao_encontrado' });

const apenasAdmin = (reply: FastifyReply) =>
  reply.status(403).send({ erro: 'Somente administradores podem definir o limite de requisições', codigo: 'apenas_admin' });

function foraDoTeto(reply: FastifyReply, dono: Usuario, permissoes: Permissao[]) {
  const fora = permissoesForaDoTeto(dono, permissoes);
  if (!fora.length) return null;
  return reply.status(400).send({
    erro: 'Permissões fora do limite liberado para o usuário', codigo: 'permissao_fora_do_limite', permissoes: fora,
  });
}

export function rotasChaves(app: FastifyInstance, chaves: RepositorioChaves, usuarios: RepositorioUsuarios): void {
  /** Key the logged-in user may manage (a corretor's view of someone else's key is a 404). */
  async function chaveVisivel(req: FastifyRequest, id: string): Promise<ChaveApiResumo | null> {
    const chave = await chaves.obter(id);
    if (!chave) return null;
    return ehAdmin(req.usuario!) || chave.dono.id === req.usuario!.id ? chave : null;
  }

  app.get<{ Querystring: { usuarioId?: string } }>(
    '/api/chaves',
    {
      schema: { querystring: { type: 'object', additionalProperties: false, properties: { usuarioId: UUID } } },
      config: ACESSO,
    },
    async (req) => {
      const eu = req.usuario!;
      const usuarioId = ehAdmin(eu) ? req.query.usuarioId : eu.id;
      // permissoesDisponiveis = what this user may grant to their own keys.
      return { chaves: await chaves.listar({ usuarioId }), permissoesDisponiveis: tetoPermissoes(eu) };
    },
  );

  app.post<{ Body: { nome: string; permissoes: Permissao[]; limitePorMinuto?: number | null; usuarioId?: string } }>(
    '/api/chaves',
    {
      schema: {
        body: {
          type: 'object', required: ['nome', 'permissoes'], additionalProperties: false,
          properties: { nome: NOME, permissoes: PERMISSOES_SCHEMA, limitePorMinuto: LIMITE, usuarioId: UUID },
        },
      },
      config: ACESSO,
    },
    async (req, reply) => {
      const eu = req.usuario!;
      const { usuarioId = eu.id, limitePorMinuto = null } = req.body;
      if (!ehAdmin(eu)) {
        if (usuarioId !== eu.id) {
          return reply.status(403).send({ erro: 'Você só pode criar chaves para si mesmo', codigo: 'acesso_negado' });
        }
        if (limitePorMinuto !== null) return apenasAdmin(reply);
      }

      let dono: Usuario = eu;
      if (usuarioId !== eu.id) {
        const outro = await usuarios.obter(usuarioId);
        if (!outro) return reply.status(404).send({ erro: 'Usuário não encontrado', codigo: 'nao_encontrado' });
        if (!outro.ativo) return reply.status(409).send({ erro: 'O usuário está desativado', codigo: 'usuario_inativo' });
        dono = outro;
      }
      const recusa = foraDoTeto(reply, dono, req.body.permissoes);
      if (recusa) return recusa;

      const { chave: segredo, prefixo, hash } = gerarChaveApi();
      const chave = await chaves.criar({
        nome: req.body.nome.trim(), prefixo, hash, permissoes: req.body.permissoes,
        limitePorMinuto, usuarioId: dono.id, criadoPor: eu.id,
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
      config: ACESSO,
    },
    async (req, reply) => {
      const eu = req.usuario!;
      if (!ehAdmin(eu) && req.body.limitePorMinuto !== undefined) return apenasAdmin(reply);
      const chave = await chaveVisivel(req, req.params.id);
      if (!chave) return naoEncontrada(reply);
      if (req.body.permissoes) {
        const dono = chave.dono.id === eu.id ? eu : await usuarios.obter(chave.dono.id);
        if (dono) {
          const recusa = foraDoTeto(reply, dono, req.body.permissoes);
          if (recusa) return recusa;
        }
      }
      const alteracao = { ...req.body, ...(req.body.nome !== undefined ? { nome: req.body.nome.trim() } : {}) };
      return responder(reply, await chaves.alterar(chave.id, alteracao));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/chaves/:id/revogar',
    { schema: { params: PARAMS_ID }, config: ACESSO },
    async (req, reply) => {
      const chave = await chaveVisivel(req, req.params.id);
      if (!chave) return naoEncontrada(reply);
      return responder(reply, await chaves.revogar(chave.id, req.usuario!.id));
    },
  );
}
