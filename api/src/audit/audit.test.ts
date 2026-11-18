// CPF masking (LGPD) for logs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializadoresLog } from './logger.ts';
import { chaveHmacCpf, hashCpf } from './cpf-hash.ts';
import { mascararCpf, textoSeguro } from './mask.ts';

test('mascararCpf: formatado, só dígitos e dentro de URLs', () => {
  assert.equal(mascararCpf('529.982.247-25'), '529.***.***-25');
  assert.equal(mascararCpf('52998224725'), '529.***.***-25');
  assert.equal(mascararCpf('/protocolos?cpf=52998224725&x=1'), '/protocolos?cpf=529.***.***-25&x=1');
  assert.equal(mascararCpf('txtCpfSegurado=529.982.247-25&page=2'), 'txtCpfSegurado=529.***.***-25&page=2');
  assert.equal(mascararCpf('a 529.982.247-25 e 111.444.777-35'), 'a 529.***.***-25 e 111.***.***-35');
});

test('mascararCpf: não altera protocolos, telefones nem texto comum', () => {
  assert.equal(mascararCpf('protocolo 18336079'), 'protocolo 18336079');
  assert.equal(mascararCpf('5511999999999'), '5511999999999');
  assert.equal(mascararCpf('HTTP 502'), 'HTTP 502');
});

test('textoSeguro: mascara e trunca', () => {
  assert.equal(textoSeguro('cpf 52998224725'), 'cpf 529.***.***-25');
  assert.equal(textoSeguro('x'.repeat(10), 4), 'xxxx…');
  assert.equal(textoSeguro('\x1b[2m - navegando\x1b[22m'), ' - navegando');
});

test('serializadores do log do console mascaram URL e erros', () => {
  const req = serializadoresLog.req({ method: 'GET', url: '/protocolos?cpf=52998224725', host: 'h', ip: '127.0.0.1' } as never);
  assert.equal(req.url, '/protocolos?cpf=529.***.***-25');
  assert.ok(!('headers' in req));
  const err = serializadoresLog.err(new Error('falhou em txtCpfSegurado=529.982.247-25'));
  assert.equal(err.message, 'falhou em txtCpfSegurado=529.***.***-25');
  assert.ok(!err.stack.includes('982.247'));
});

test('hashCpf: igual com ou sem formatação, muda com a chave, não contém o CPF', () => {
  const chave = 'k'.repeat(32);
  const h = hashCpf('529.982.247-25', chave);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(hashCpf('52998224725', chave), h);
  assert.notEqual(hashCpf('52998224725', 'z'.repeat(32)), h);
  assert.ok(!h.includes('52998224725'));
  // Fixed vector: the dashboard (server/utils/cpf-hash.ts) must produce the same value.
  assert.equal(h, 'a9032b49a90d0833a723bdbc00b3d0d0875a34eb27db967b9f4a761416f694f4');
});

test('chaveHmacCpf: exige 32+ caracteres', () => {
  assert.throws(() => chaveHmacCpf(undefined), /CPF_HMAC_CHAVE/);
  assert.throws(() => chaveHmacCpf('curta'), /mínimo 32/);
  assert.equal(chaveHmacCpf('k'.repeat(32)), 'k'.repeat(32));
});
