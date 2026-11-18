// Login, logout, current user and preferences.

import type { FastifyInstance } from 'fastify';
import type { BloqueioLogin } from '../auth/login-throttle.ts';
import { HASH_FICTICIO, hashSenha, SENHA_MIN, verificarSenha } from '../auth/passwords.ts';
import { COOKIE_SESSAO, gerarToken, hashToken } from '../auth/tokens.ts';
import { IDIOMAS, type Idioma, type RepositorioContas } from '../repositories/types.ts';

export interface OpcoesRotasAuth {
  contas: RepositorioContas;
  bloqueio: BloqueioLogin;
  cookieSeguro: boolean;
  duracaoMaximaMs: number;
}

export function rotasAuth(app: FastifyInstance, o: OpcoesRotasAuth): void {
  const opcoesCookie = { path: '/', httpOnly: true, secure: o.cookieSeguro, sameSite: 'strict' as const };

  app.post<{ Body: { email: string; senha: string } }>(
    '/api/auth/login',
    {
      config: { publica: true },
      schema: {
        body: {
          type: 'object', required: ['email', 'senha'], additionalProperties: false,
          properties: { email: { type: 'string', minLength: 3, maxLength: 200 }, senha: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const { email, senha } = req.body;
      const bloqueadoMs = o.bloqueio.bloqueadoPor(email);
      if (bloqueadoMs > 0) {
        const segundos = Math.ceil(bloqueadoMs / 1000);
        return reply
          .status(429)
          .header('Retry-After', segundos)
          .send({ erro: 'Muitas tentativas de login. Tente novamente mais tarde.', codigo: 'login_bloqueado', tenteNovamenteEmSegundos: segundos });
      }

      const usuario = await o.contas.buscarParaLogin(email);
      // Always run scrypt (dummy hash for unknown e-mails), so timing does not reveal registered e-mails.
      const senhaOk = await verificarSenha(senha, usuario?.senhaHash ?? HASH_FICTICIO);
      if (!usuario || !usuario.ativo || !senhaOk) {
        o.bloqueio.registrarFalha(email);
        return reply.status(401).send({ erro: 'E-mail ou senha inválidos', codigo: 'credenciais_invalidas' });
      }

      o.bloqueio.registrarSucesso(email);
      const { token, hash } = gerarToken();
      await o.contas.criarSessao({
        usuarioId: usuario.id, tokenHash: hash, expiraEm: new Date(Date.now() + o.duracaoMaximaMs),
        ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null,
      });
      await o.contas.registrarLogin(usuario.id);
      reply.setCookie(COOKIE_SESSAO, token, { ...opcoesCookie, maxAge: Math.floor(o.duracaoMaximaMs / 1000) });
      const { id, nome, email: emailCadastrado, idioma } = usuario;
      return { usuario: { id, nome, email: emailCadastrado, idioma } };
    },
  );

  // Public so a stale cookie can always be cleared.
  app.post('/api/auth/logout', { config: { publica: true } }, async (req, reply) => {
    const token = req.cookies[COOKIE_SESSAO];
    if (token) await o.contas.encerrarSessao(hashToken(token));
    reply.clearCookie(COOKIE_SESSAO, opcoesCookie);
    return reply.status(204).send();
  });

  app.get('/api/auth/eu', async (req) => ({ usuario: req.usuario }));

  // Change my own password: requires the current one (a stolen open session alone is not enough),
  // counts wrong attempts in the same brute-force block as login, and ends the user's other sessions.
  app.post<{ Body: { senhaAtual: string; novaSenha: string } }>(
    '/api/auth/eu/senha',
    {
      schema: {
        body: {
          type: 'object', required: ['senhaAtual', 'novaSenha'], additionalProperties: false,
          properties: {
            senhaAtual: { type: 'string', minLength: 1, maxLength: 200 },
            novaSenha: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const usuario = req.usuario!;
      const bloqueadoMs = o.bloqueio.bloqueadoPor(usuario.email);
      if (bloqueadoMs > 0) {
        const segundos = Math.ceil(bloqueadoMs / 1000);
        return reply.status(429).header('Retry-After', segundos).send({
          erro: 'Muitas tentativas. Tente novamente mais tarde.', codigo: 'login_bloqueado', tenteNovamenteEmSegundos: segundos,
        });
      }
      const atual = await o.contas.hashDaSenha(usuario.id);
      if (!atual || !(await verificarSenha(req.body.senhaAtual, atual))) {
        o.bloqueio.registrarFalha(usuario.email);
        return reply.status(400).send({ erro: 'Senha atual incorreta', codigo: 'senha_atual_incorreta' });
      }
      if (req.body.novaSenha.length < SENHA_MIN) {
        return reply.status(400).send({ erro: `A nova senha deve ter pelo menos ${SENHA_MIN} caracteres`, codigo: 'senha_curta', minimo: SENHA_MIN });
      }
      if (req.body.novaSenha === req.body.senhaAtual) {
        return reply.status(400).send({ erro: 'A nova senha deve ser diferente da atual', codigo: 'senha_igual' });
      }
      o.bloqueio.registrarSucesso(usuario.email);
      await o.contas.alterarSenha(usuario.id, await hashSenha(req.body.novaSenha), req.sessaoId!);
      return reply.status(204).send();
    },
  );

  app.patch<{ Body: { idioma: Idioma } }>(
    '/api/auth/eu',
    {
      schema: {
        body: {
          type: 'object', required: ['idioma'], additionalProperties: false,
          properties: { idioma: { type: 'string', enum: [...IDIOMAS] } },
        },
      },
    },
    async (req) => {
      await o.contas.definirIdioma(req.usuario!.id, req.body.idioma);
      return { usuario: { ...req.usuario!, idioma: req.body.idioma } };
    },
  );
}
