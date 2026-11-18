// HTTP API definition (Fastify). Receives a ready-made service, so routes can be
// tested with a fake service, without opening a browser.

import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { RegistroDestinos } from '../delivery/registry.ts';
import { arquivoEmJson, ErroEntrega, type PedidoEnvio } from '../delivery/types.ts';
import type { Protocolo } from '../scraper/portal.ts';
import { documentoDoPdf, enviarPdf, nomeArquivoPdf } from '../services/documents.ts';
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

const PARAMS_PROTOCOLO = {
  type: 'object',
  required: ['protocolo'],
  properties: { protocolo: { type: 'string', pattern: '^\\d+$', maxLength: 20 } },
} as const;

const schemaPdf = {
  params: PARAMS_PROTOCOLO,
  querystring: {
    type: 'object',
    additionalProperties: false,
    // binario = raw application/pdf (default); base64 = JSON, for integrations that can't handle binary.
    properties: { formato: { type: 'string', enum: ['binario', 'base64'], default: 'binario' } },
  },
} as const;

const schemaEnvio = {
  params: PARAMS_PROTOCOLO,
  body: {
    type: 'object',
    required: ['destino'],
    additionalProperties: false,
    properties: {
      destino: { type: 'string', minLength: 1, maxLength: 50 },
      destinatario: { type: 'string', minLength: 1, maxLength: 100 },
      mensagem: { type: 'string', minLength: 1, maxLength: 1000 },
      referencia: { type: 'string', minLength: 1, maxLength: 100 },
    },
  },
} as const;

/** Public shape of a protocol (without the Broker's internal URL). */
function paraResposta({ pdfUrl, idInterno, ...p }: Protocolo) {
  return { ...p, possuiPdf: Boolean(pdfUrl), pdf: pdfUrl ? `/protocolos/${p.protocolo}/pdf` : null };
}

export interface OpcoesApp {
  logger?: boolean;
  /** Destinations available to POST /protocolos/:protocolo/pdf/envios (none by default). */
  destinos?: RegistroDestinos;
}

export function criarApp(servico: ServicoProtocolos, opcoes: OpcoesApp = {}): FastifyInstance {
  const destinos: RegistroDestinos = opcoes.destinos ?? new Map();
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
    if (erro instanceof ErroEntrega) {
      return reply.status(502).send({ erro: 'Falha ao entregar o PDF no destino', destino: erro.destino });
    }
    return reply.status(502).send({ erro: 'Falha ao consultar o portal. Tente novamente.' });
  });

  app.get('/health', async () => ({ ok: true, sessao: servico.status() }));

  // Configured destinations (names and kinds only; URLs and tokens stay private).
  app.get('/destinos', async () => ({
    destinos: [...destinos.values()].map((d) => ({ nome: d.nome, tipo: d.tipo })),
  }));

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

  app.get<{ Params: { protocolo: string }; Querystring: { formato: 'binario' | 'base64' } }>(
    '/protocolos/:protocolo/pdf',
    { schema: schemaPdf },
    async (req, reply) => {
      const resultado = await servico.obterPdf(req.params.protocolo);
      switch (resultado.tipo) {
        case 'nao_encontrado':
          return reply.status(404).send({ erro: 'Protocolo não encontrado' });
        case 'sem_pdf':
          return reply.status(404).send({ erro: 'Protocolo não possui PDF da Proposta' });
        case 'ok': {
          const numero = resultado.protocolo.protocolo;
          if (req.query.formato === 'base64') {
            return { protocolo: numero, arquivo: arquivoEmJson(documentoDoPdf(numero, resultado.pdf)) };
          }
          return reply
            .header('Content-Type', 'application/pdf')
            .header('Content-Disposition', `attachment; filename="${nomeArquivoPdf(numero)}"`)
            .send(resultado.pdf);
        }
      }
    },
  );

  // Generic push: fetch the PDF and deliver it to a configured destination (webhook, WhatsApp gateway...).
  app.post<{ Params: { protocolo: string }; Body: PedidoEnvio & { destino: string } }>(
    '/protocolos/:protocolo/pdf/envios',
    { schema: schemaEnvio },
    async (req, reply) => {
      const { destino, ...pedido } = req.body;
      const resultado = await enviarPdf(servico, destinos, req.params.protocolo, destino, pedido);
      switch (resultado.tipo) {
        case 'destino_desconhecido':
          return reply.status(400).send({ erro: 'Destino desconhecido', destinosDisponiveis: [...destinos.keys()] });
        case 'nao_encontrado':
          return reply.status(404).send({ erro: 'Protocolo não encontrado' });
        case 'sem_pdf':
          return reply.status(404).send({ erro: 'Protocolo não possui PDF da Proposta' });
        case 'enviado':
          return {
            enviado: true,
            destino: resultado.destino,
            protocolo: resultado.documento.protocolo,
            arquivo: { nome: resultado.documento.nome, tamanho: resultado.documento.conteudo.length },
            referencia: pedido.referencia ?? null,
          };
      }
    },
  );

  return app;
}
