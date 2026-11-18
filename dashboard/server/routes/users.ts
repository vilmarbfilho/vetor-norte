// User management (admins only): list, create, edit profile/screens/API ceiling, (de)activate,
// reset password. New users and resets get a generated temporary password, returned ONCE, that must be
// changed at the next login.
//
// An admin cannot change their own profile, deactivate themselves or reset their own password here
// (they use "My account"). This also guarantees there is always at least one active admin.

import type { FastifyInstance, FastifyReply } from 'fastify';
import { PERFIS, TELAS, type Perfil, type Tela } from '../auth/access.ts';
import { PERMISSOES, type Permissao } from '../auth/api-keys.ts';
import { gerarSenhaTemporaria, hashSenha } from '../auth/passwords.ts';
import type { AlteracaoUsuario, RepositorioUsuarios, ResultadoUsuario } from '../repositories/types.ts';

const ACESSO = { acesso: 'admin' } as const;
const NOME = { type: 'string', minLength: 1, maxLength: 100 } as const;
const EMAIL = { type: 'string', minLength: 3, maxLength: 200, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' } as const;
const PERFIL = { type: 'string', enum: [...PERFIS] } as const;
const TELAS_SCHEMA = { type: 'array', uniqueItems: true, items: { type: 'string', enum: [...TELAS] } } as const;
const PERMISSOES_SCHEMA = { type: 'array', uniqueItems: true, items: { type: 'string', enum: [...PERMISSOES] } } as const;
const PARAMS_ID = { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } as const;

function responder(reply: FastifyReply, r: ResultadoUsuario, extra: Record<string, unknown> = {}) {
  switch (r.tipo) {
    case 'nao_encontrado':
      return reply.status(404).send({ erro: 'Usuário não encontrado', codigo: 'nao_encontrado' });
    case 'email_em_uso':
      return reply.status(409).send({ erro: 'Já existe um usuário com este e-mail', codigo: 'email_em_uso' });
    case 'ok':
      return { usuario: r.usuario, ...extra };
  }
}

const proprioUsuario = (reply: FastifyReply) =>
  reply.status(409).send({ erro: 'Não é possível fazer isto com o próprio usuário', codigo: 'proprio_usuario' });

export function rotasUsuarios(app: FastifyInstance, usuarios: RepositorioUsuarios): void {
  app.get('/api/usuarios', { config: ACESSO }, async () => ({
    usuarios: await usuarios.listar(), telasDisponiveis: TELAS, permissoesDisponiveis: PERMISSOES,
  }));

  app.post<{ Body: { nome: string; email: string; perfil: Perfil; telas?: Tela[]; permissoesApi?: Permissao[] } }>(
    '/api/usuarios',
    {
      schema: {
        body: {
          type: 'object', required: ['nome', 'email', 'perfil'], additionalProperties: false,
          properties: { nome: NOME, email: EMAIL, perfil: PERFIL, telas: TELAS_SCHEMA, permissoesApi: PERMISSOES_SCHEMA },
        },
      },
      config: ACESSO,
    },
    async (req, reply) => {
      const senhaTemporaria = gerarSenhaTemporaria();
      const r = await usuarios.criar({
        nome: req.body.nome.trim(), email: req.body.email.trim().toLowerCase(), perfil: req.body.perfil,
        telas: req.body.telas ?? [], permissoesApi: req.body.permissoesApi ?? [],
        senhaHash: await hashSenha(senhaTemporaria),
      });
      if (r.tipo !== 'ok') return responder(reply, r);
      // The only time the temporary password leaves the server.
      return reply.status(201).header('Cache-Control', 'no-store').send({ usuario: r.usuario, senhaTemporaria });
    },
  );

  app.patch<{ Params: { id: string }; Body: AlteracaoUsuario }>(
    '/api/usuarios/:id',
    {
      schema: {
        params: PARAMS_ID,
        body: {
          type: 'object', additionalProperties: false, minProperties: 1,
          properties: { nome: NOME, email: EMAIL, perfil: PERFIL, telas: TELAS_SCHEMA, permissoesApi: PERMISSOES_SCHEMA },
        },
      },
      config: ACESSO,
    },
    async (req, reply) => {
      if (req.params.id === req.usuario!.id && req.body.perfil !== undefined && req.body.perfil !== req.usuario!.perfil) {
        return proprioUsuario(reply);
      }
      const { nome, email, ...resto } = req.body;
      return responder(reply, await usuarios.alterar(req.params.id, {
        ...resto,
        ...(nome !== undefined ? { nome: nome.trim() } : {}),
        ...(email !== undefined ? { email: email.trim().toLowerCase() } : {}),
      }));
    },
  );

  for (const [acao, ativo] of [['ativar', true], ['desativar', false]] as const) {
    app.post<{ Params: { id: string } }>(
      `/api/usuarios/:id/${acao}`,
      { schema: { params: PARAMS_ID }, config: ACESSO },
      async (req, reply) => {
        if (req.params.id === req.usuario!.id) return proprioUsuario(reply);
        return responder(reply, await usuarios.definirAtivo(req.params.id, ativo));
      },
    );
  }

  app.post<{ Params: { id: string } }>(
    '/api/usuarios/:id/redefinir-senha',
    { schema: { params: PARAMS_ID }, config: ACESSO },
    async (req, reply) => {
      if (req.params.id === req.usuario!.id) return proprioUsuario(reply);
      const senhaTemporaria = gerarSenhaTemporaria();
      const r = await usuarios.redefinirSenha(req.params.id, await hashSenha(senhaTemporaria));
      if (r.tipo !== 'ok') return responder(reply, r);
      return reply.header('Cache-Control', 'no-store').send({ usuario: r.usuario, senhaTemporaria });
    },
  );
}
