// Both languages must have the same keys and the same placeholders.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { en } from './en';
import { pt } from './pt';
import { formatar, traduzir } from './translate';

const marcadores = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('pt e en têm as mesmas chaves e os mesmos marcadores', () => {
  assert.deepEqual(Object.keys(pt).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en) as (keyof typeof en)[]) {
    assert.deepEqual(marcadores(pt[k]), marcadores(en[k]), k);
    assert.ok(pt[k].trim(), `tradução vazia: ${k}`);
  }
});

test('todo código de erro do backend tem tradução', () => {
  const codigos = ['credenciais_invalidas', 'login_bloqueado', 'nao_autenticado', 'parametros_invalidos', 'chave_revogada',
    'nao_encontrado', 'senha_atual_incorreta', 'senha_curta', 'senha_igual', 'csrf', 'erro_interno'];
  for (const c of codigos) assert.ok(`erro.${c}` in en, c);
});

test('formatar substitui marcadores conhecidos e preserva os desconhecidos', () => {
  assert.equal(formatar('{a} e {b}', { a: 1 }), '1 e {b}');
  assert.equal(traduzir('pt', 'erro.login_bloqueado', { minutos: 15 }), 'Muitas tentativas. Tente novamente em 15 min.');
  assert.equal(traduzir('en', 'chaves.permissao.pdf:baixar.ajuda'), 'GET /protocolos/{n}/pdf');
});
