// Builds the set of available destinations from environment variables.
// Destination URLs come ONLY from server config, never from the request: the API has no
// authentication, so accepting a URL from the caller would turn it into an open relay (SSRF)
// for personal data.
//
// Convention: DESTINO_<NOME>_URL (required), DESTINO_<NOME>_TOKEN, DESTINO_<NOME>_TIMEOUT_MS.
// <NOME> becomes the lowercase destination name, e.g. DESTINO_WHATSAPP_URL -> "whatsapp".

import type { Destino } from './types.ts';
import { DestinoWebhook } from './webhook.ts';

export type RegistroDestinos = ReadonlyMap<string, Destino>;

const PADRAO_URL = /^DESTINO_([A-Z0-9_]+)_URL$/;

export function destinosDoAmbiente(env: Record<string, string | undefined>): RegistroDestinos {
  const destinos = new Map<string, Destino>();
  for (const [chave, url] of Object.entries(env)) {
    const m = PADRAO_URL.exec(chave);
    if (!m || !url) continue;
    const prefixo = `DESTINO_${m[1]}`;
    const nome = m[1]!.toLowerCase().replaceAll('_', '-');

    // Fail at startup rather than on the first delivery.
    let protocolo: string;
    try {
      protocolo = new URL(url).protocol;
    } catch {
      throw new Error(`${chave} não é uma URL válida`);
    }
    if (protocolo !== 'http:' && protocolo !== 'https:') throw new Error(`${chave} deve usar http ou https`);

    const timeout = env[`${prefixo}_TIMEOUT_MS`];
    if (timeout !== undefined && !(Number(timeout) > 0)) throw new Error(`${prefixo}_TIMEOUT_MS inválido`);

    destinos.set(
      nome,
      new DestinoWebhook({
        nome,
        url,
        token: env[`${prefixo}_TOKEN`] || undefined,
        timeoutMs: timeout ? Number(timeout) : undefined,
      }),
    );
  }
  return destinos;
}
