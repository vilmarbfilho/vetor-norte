// Request guards for /api: CSRF check on state-changing requests, session cookie validation, forced
// password change and access by profile.
// - { config: { publica: true } }: no session needed (login, logout, health).
// - { config: { acesso: 'todos' | 'admin' | <tela> } }: required on every other /api route (checked at startup).
// - { config: { duranteTrocaSenha: true } }: still allowed while the user must change a temporary password.

import type { FastifyInstance } from 'fastify';
import type { RepositorioContas, Usuario } from '../repositories/types.ts';
import { podeAcessar, type Acesso } from './access.ts';
import { COOKIE_SESSAO, hashToken } from './tokens.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** No logged-in session needed. */
    publica?: boolean;
    /** Who may call this route (see access.ts). */
    acesso?: Acesso;
    /** Allowed while the user still has to change a temporary password. */
    duranteTrocaSenha?: boolean;
  }
  interface FastifyRequest {
    /** Logged-in user (set by the session guard). */
    usuario?: Usuario;
    /** Id of the current session (set by the session guard). */
    sessaoId?: string;
  }
}

/** Header the frontend sends on every state-changing call (see web/ api client). */
export const CABECALHO_CSRF = 'x-requested-with';
export const VALOR_CSRF = 'vetornorte-dashboard';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function registrarGuardas(
  app: FastifyInstance,
  opcoes: { contas: RepositorioContas; inatividadeMs: number; cookieSeguro: boolean },
): void {
  // Fail at startup, not at runtime: a protected route without a declared access level is a bug.
  app.addHook('onRoute', (rota) => {
    const url = rota.url ?? '';
    if (url.startsWith('/api/') && !rota.config?.publica && !rota.config?.acesso) {
      throw new Error(`Rota ${rota.method} ${url} sem config.acesso`);
    }
  });

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return; // static frontend files

    // CSRF: besides SameSite=Strict, a custom header is required. Browsers only let other sites send
    // custom headers after a CORS preflight, and this server never answers CORS, so a forged form or
    // fetch from another origin cannot pass.
    if (!METODOS_SEGUROS.has(req.method) && req.headers[CABECALHO_CSRF] !== VALOR_CSRF) {
      return reply.status(403).send({ erro: 'Requisição bloqueada (CSRF)', codigo: 'csrf' });
    }

    if (req.routeOptions.config.publica) return;

    const token = req.cookies[COOKIE_SESSAO];
    const sessao = token ? await opcoes.contas.sessaoValida(hashToken(token), opcoes.inatividadeMs) : null;
    if (!sessao) {
      if (token) reply.clearCookie(COOKIE_SESSAO, { path: '/', httpOnly: true, secure: opcoes.cookieSeguro, sameSite: 'strict' });
      return reply.status(401).send({ erro: 'Sessão expirada ou inexistente. Faça login.', codigo: 'nao_autenticado' });
    }
    req.usuario = sessao.usuario;
    req.sessaoId = sessao.sessaoId;
    opcoes.contas.tocarSessao(sessao.sessaoId).catch((e: Error) => req.log.warn(`falha ao renovar sessão: ${e.message}`));

    const config = req.routeOptions.config;
    if (sessao.usuario.trocarSenha && !config.duranteTrocaSenha) {
      return reply.status(403).send({ erro: 'Defina uma nova senha para continuar', codigo: 'troca_senha_obrigatoria' });
    }
    // Unknown /api URLs have no config: they fall through to the JSON 404.
    if (config.acesso && !podeAcessar(sessao.usuario, config.acesso)) {
      return reply.status(403).send({ erro: 'Acesso não permitido', codigo: 'acesso_negado' });
    }
  });
}
