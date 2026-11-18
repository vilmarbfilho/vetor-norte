// Fastify/pino serializers that mask CPFs in console logs (request URLs carry ?cpf=...,
// and portal errors may include the search URL).

import type { FastifyRequest } from 'fastify';
import { mascararCpf } from './mask.ts';

export const serializadoresLog = {
  req(req: FastifyRequest) {
    // Same fields as Fastify's default serializer, with the URL masked. Headers (API key) are never logged.
    return { method: req.method, url: mascararCpf(req.url), host: req.host, remoteAddress: req.ip };
  },
  err(erro: Error & { code?: string }) {
    return {
      type: erro.name,
      message: mascararCpf(erro.message ?? ''),
      stack: mascararCpf(erro.stack ?? ''),
      ...(erro.code ? { code: erro.code } : {}),
    };
  },
};
