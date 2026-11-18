// HTTP API definition (Fastify). Receives a ready-made service, so routes can be
// tested with a fake service, without opening a browser.

import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Protocolo } from '../scraper/portal.ts';
import type { FiltrosListagem } from '../services/filters.ts';
import type { ServicoProtocolos } from '../services/protocols.ts';
import { cpfValido, formatarCpf, somenteDigitos } from '../utils/cpf.ts';

const DATA = { type: 'string', pattern: '^(\\d{4}-\\d{2}-\\d{2}|\\d{2}/\\d{2}/\\d{4})$' } as const;
const TEXTO = { type: 'string', minLength: 1, maxLength: 100 } as const;

const schemaListagem = {
  querystring: {
    type: 'object',
    required: ['cpf'],
    additionalProperties: false,
    properties: {
      cpf: { type: 'string', minLength: 11, maxLength: 14 },
      protocolo: { type: 'string', pattern: '^\\d+$' },
      dataProtocoloDe: DATA,
      dataProtocoloAte: DATA,
      vigenciaInicioDe: DATA,
      vigenciaInicioAte: DATA,
      vigenciaFimDe: DATA,
      vigenciaFimAte: DATA,
      segurado: TEXTO,
      seguradora: TEXTO,
      statusProtocolo: TEXTO,
      statusProposta: TEXTO,
      statusSinistro: TEXTO,
    },
  },
} as const;

const schemaPdf = {
  params: {
    type: 'object',
    required: ['protocolo'],
    properties: { protocolo: { type: 'string', pattern: '^\\d+$', maxLength: 20 } },
  },
} as const;

/** Public shape of a protocol (without the Broker's internal URL). */
function paraResposta({ pdfUrl, idInterno, ...p }: Protocolo) {
  return { ...p, possuiPdf: Boolean(pdfUrl), pdf: pdfUrl ? `/protocolos/${p.protocolo}/pdf` : null };
}

export function criarApp(servico: ServicoProtocolos, opcoes: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: opcoes.logger ?? false,
    // Unknown query parameters become a 400 instead of being silently dropped.
    ajv: { customOptions: { removeAdditional: false } },
  });

  // Validation errors -> 400 with a readable message; anything else -> 502 (portal query failed).
  app.setErrorHandler<FastifyError>((erro, req, reply) => {
    if (erro.validation) {
      return reply.status(400).send({ erro: 'Parâmetros inválidos', detalhes: erro.message });
    }
    req.log.error(erro);
    return reply.status(502).send({ erro: 'Falha ao consultar o portal. Tente novamente.' });
  });

  app.get('/health', async () => ({ ok: true, sessao: servico.status() }));

  app.get<{ Querystring: FiltrosListagem & { cpf: string } }>(
    '/protocolos',
    { schema: schemaListagem },
    async (req, reply) => {
      const { cpf, ...filtros } = req.query;
      if (somenteDigitos(cpf).length !== 11 || !cpfValido(cpf)) {
        return reply.status(400).send({ erro: 'CPF inválido' });
      }
      const protocolos = await servico.listarPorCpf(cpf, filtros);
      return { cpf: formatarCpf(cpf), total: protocolos.length, protocolos: protocolos.map(paraResposta) };
    },
  );

  app.get<{ Params: { protocolo: string } }>(
    '/protocolos/:protocolo/pdf',
    { schema: schemaPdf },
    async (req, reply) => {
      const resultado = await servico.obterPdf(req.params.protocolo);
      switch (resultado.tipo) {
        case 'nao_encontrado':
          return reply.status(404).send({ erro: 'Protocolo não encontrado' });
        case 'sem_pdf':
          return reply.status(404).send({ erro: 'Protocolo não possui PDF da Proposta' });
        case 'ok':
          return reply
            .header('Content-Type', 'application/pdf')
            .header('Content-Disposition', `attachment; filename="proposta_${resultado.protocolo.protocolo}.pdf"`)
            .send(resultado.pdf);
      }
    },
  );

  return app;
}
