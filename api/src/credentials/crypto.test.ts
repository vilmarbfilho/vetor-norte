import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chaveCredenciais, cifrarSenha, decifrarSenha } from './crypto.ts';

const CHAVE = Buffer.alloc(32, 7);
const USUARIO = '00000000-0000-4000-8000-0000000000c1';

// Fixed vector encrypted by the dashboard (same vector in dashboard/server/utils/credentials-crypto.test.ts).
test('credenciais: decifra o vetor fixo gerado pelo dashboard', () => {
  const dado = Buffer.from('j8tt6UhkghZfieLc49i0GzIBU/fn8BOuq7HgHITMP0dqu/PeTIF4wyHlnynX+po=', 'base64');
  assert.equal(decifrarSenha(dado, CHAVE, USUARIO), 'senha-do-portal-Ç1');
});

test('credenciais: outro usuário ou outra chave não decifram', () => {
  const dado = cifrarSenha('segredo', CHAVE, USUARIO);
  assert.equal(decifrarSenha(dado, CHAVE, USUARIO), 'segredo');
  assert.throws(() => decifrarSenha(dado, CHAVE, '00000000-0000-4000-8000-0000000000c2'));
  assert.throws(() => decifrarSenha(dado, Buffer.alloc(32, 8), USUARIO));
});

test('credenciais: CREDENCIAIS_CHAVE precisa ter 32 bytes em base64', () => {
  assert.equal(chaveCredenciais(CHAVE.toString('base64')).length, 32);
  for (const ruim of [undefined, '', 'curta']) assert.throws(() => chaveCredenciais(ruim), /CREDENCIAIS_CHAVE/);
});
