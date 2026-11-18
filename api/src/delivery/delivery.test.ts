// Delivery layer tests: env parsing and webhook adapter (fake fetch, no network).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { destinosDoAmbiente } from './registry.ts';
import { ErroEntrega, type Documento } from './types.ts';
import { DestinoWebhook, EVENTO_PDF_PROPOSTA } from './webhook.ts';

const doc: Documento = { nome: 'proposta_10.pdf', mimeType: 'application/pdf', conteudo: Buffer.from('%PDF-1.7 fake'), protocolo: '10' };

test('destinosDoAmbiente cria um webhook por DESTINO_<NOME>_URL', () => {
  const destinos = destinosDoAmbiente({
    DESTINO_N8N_URL: 'https://n8n.example.com/hook',
    DESTINO_WHATS_APP_URL: 'http://127.0.0.1:9000/pdf',
    DESTINO_VAZIO_URL: '',
    OUTRA_COISA: 'x',
  });
  assert.deepEqual([...destinos.keys()].sort(), ['n8n', 'whats-app']);
  assert.equal(destinos.get('n8n')!.tipo, 'webhook');
});

test('destinosDoAmbiente rejeita configuração inválida', () => {
  assert.throws(() => destinosDoAmbiente({ DESTINO_X_URL: 'não-é-url' }), /URL válida/);
  assert.throws(() => destinosDoAmbiente({ DESTINO_X_URL: 'file:///etc/passwd' }), /http ou https/);
  assert.throws(() => destinosDoAmbiente({ DESTINO_X_URL: 'https://a', DESTINO_X_TIMEOUT_MS: 'abc' }), /TIMEOUT_MS/);
});

test('webhook envia JSON com o PDF em base64 e o token', async () => {
  let recebido: { url: string; init: RequestInit } | undefined;
  const destino = new DestinoWebhook({
    nome: 'n8n',
    url: 'https://n8n.example.com/hook',
    token: 'segredo',
    fetch: async (url, init) => {
      recebido = { url: String(url), init: init! };
      return new Response('ok', { status: 200 });
    },
  });

  const r = await destino.enviar(doc, { destinatario: '5511999999999', mensagem: 'Sua proposta', referencia: 'abc' });
  assert.equal(r.status, 200);
  assert.equal(recebido!.url, 'https://n8n.example.com/hook');
  const headers = recebido!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer segredo');
  const corpo = JSON.parse(String(recebido!.init.body));
  assert.equal(corpo.evento, EVENTO_PDF_PROPOSTA);
  assert.equal(corpo.protocolo, '10');
  assert.equal(corpo.destinatario, '5511999999999');
  assert.equal(corpo.referencia, 'abc');
  assert.equal(Buffer.from(corpo.arquivo.base64, 'base64').toString(), '%PDF-1.7 fake');
  assert.equal(corpo.arquivo.tamanho, doc.conteudo.length);
});

test('webhook lança ErroEntrega em HTTP de erro ou falha de rede', async () => {
  const http500 = new DestinoWebhook({ nome: 'x', url: 'https://a', fetch: async () => new Response('', { status: 500 }) });
  await assert.rejects(http500.enviar(doc, {}), (e) => e instanceof ErroEntrega && /HTTP 500/.test(e.message));

  const offline = new DestinoWebhook({ nome: 'x', url: 'https://a', fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(offline.enviar(doc, {}), (e) => e instanceof ErroEntrega && e.destino === 'x');
});
