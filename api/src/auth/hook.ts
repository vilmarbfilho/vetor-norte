// Fastify hook that authenticates every request with an API key, checks the route's
// permission and applies the per-key rate limit. Routes declare what they need via `config`:
//   { config: { permissao: 'pdf:baixar' } }  or  { config: { publica: true } }

import type { FastifyInstance } from 'fastify';
import { chaveDosCabecalhos, hashDaChave, type ChaveApi, type Permissao } from './keys.ts';
import { LimitadorPorMinuto } from './rate-limit.ts';
import type { RepositorioChaves } from './repository.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Permission the API key must hold to call this route. */
    permissao?: Permissao;
    /** No API key needed (e.g. /health for container health checks). */
    publica?: boolean;
  }
  interface FastifyRequest {
    /** Authenticated key (set by the auth hook; undefined on public routes). */
    chaveApi?: ChaveApi;
  }
}

export interface OpcoesAutenticacao {
  repositorio: RepositorioChaves;
  rateLimit: {
    /** RATE_LIMIT_HABILITADO: false turns the limiter off entirely. */
    habilitado: boolean;
    /** Requests per minute for keys without their own `limite_por_minuto`. */
    porMinutoPadrao: number;
  };
  /** Injectable for tests. */
  limitador?: LimitadorPorMinuto;
}

export function registrarAutenticacao(app: FastifyInstance, opcoes: OpcoesAutenticacao): void {
  const limitador = opcoes.limitador ?? new LimitadorPorMinuto();

  // onRequest runs before body parsing and validation: unauthenticated calls cost almost nothing.
  app.addHook('onRequest', async (req, reply) => {
    const config = req.routeOptions.config;
    if (config.publica) return;

    const segredo = chaveDosCabecalhos(req.headers);
    if (!segredo) {
      return reply
        .status(401)
        .header('WWW-Authenticate', 'Bearer')
        .send({ erro: 'API key ausente. Envie "Authorization: Bearer <chave>" ou "X-API-Key: <chave>".' });
    }

    let chave: ChaveApi | null;
    try {
      chave = await opcoes.repositorio.buscarPorHash(hashDaChave(segredo));
    } catch (e) {
      // DB down: fail closed (no access), with a status that tells the caller to retry later.
      req.log.error({ err: e }, 'falha ao validar API key');
      req.erroCapturado = e as Error; // goes to the error log (onResponse), if the DB comes back
      return reply.status(503).send({ erro: 'Autenticação indisponível. Tente novamente.' });
    }
    if (!chave) {
      return reply.status(401).header('WWW-Authenticate', 'Bearer').send({ erro: 'API key inválida ou revogada' });
    }
    req.chaveApi = chave;

    // Routes without a declared permission (e.g. unknown URLs -> 404) only require a valid key.
    if (config.permissao && !chave.permissoes.includes(config.permissao)) {
      return reply
        .status(403)
        .send({ erro: 'API key sem permissão para esta operação', permissaoNecessaria: config.permissao });
    }

    if (opcoes.rateLimit.habilitado) {
      const r = limitador.consumir(chave.id, chave.limitePorMinuto ?? opcoes.rateLimit.porMinutoPadrao);
      reply.header('X-RateLimit-Limit', r.limite).header('X-RateLimit-Remaining', r.restantes);
      if (!r.permitido) {
        return reply
          .status(429)
          .header('Retry-After', r.reiniciaEmSegundos)
          .send({ erro: 'Limite de requisições excedido', tenteNovamenteEmSegundos: r.reiniciaEmSegundos });
      }
    }

    opcoes.repositorio.registrarUso(chave.id);
  });
}
