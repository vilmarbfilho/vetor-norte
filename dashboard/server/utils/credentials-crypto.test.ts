import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chaveCredenciais, cifrarSenha, decifrarSenha } from './credentials-crypto.ts';

const CHAVE = Buffer.alloc(32, 7);
const USUARIO = '00000000-0000-4000-8000-0000000000c1';

test('credenciais: cifra e decifra; IV aleatório (cifras diferentes para a mesma senha)', () => {
  const a = cifrarSenha('senha-do-portal-Ç1', CHAVE, USUARIO);
  const b = cifrarSenha('senha-do-portal-Ç1', CHAVE, USUARIO);
  assert.notDeepEqual(a, b);
  assert.equal(decifrarSenha(a, CHAVE, USUARIO), 'senha-do-portal-Ç1');
  assert.ok(!a.toString('latin1').includes('senha'));
});

test('credenciais: outro usuário, outra chave ou dado adulterado não decifram', () => {
  const dado = cifrarSenha('segredo', CHAVE, USUARIO);
  assert.throws(() => decifrarSenha(dado, CHAVE, '00000000-0000-4000-8000-0000000000c2'));
  assert.throws(() => decifrarSenha(dado, Buffer.alloc(32, 8), USUARIO));
  const adulterado = Buffer.from(dado);
  adulterado[adulterado.length - 1]! ^= 1;
  assert.throws(() => decifrarSenha(adulterado, CHAVE, USUARIO));
  assert.throws(() => decifrarSenha(Buffer.alloc(28), CHAVE, USUARIO));
});

// Fixed vector: the API (stage 17) must decrypt exactly this. Same vector in the API test suite.
test('credenciais: vetor fixo compartilhado com a API', () => {
  const dado = Buffer.from('j8tt6UhkghZfieLc49i0GzIBU/fn8BOuq7HgHITMP0dqu/PeTIF4wyHlnynX+po=', 'base64');
  assert.equal(decifrarSenha(dado, CHAVE, USUARIO), 'senha-do-portal-Ç1');
});

test('credenciais: CREDENCIAIS_CHAVE precisa ter 32 bytes em base64', () => {
  assert.equal(chaveCredenciais(CHAVE.toString('base64')).length, 32);
  for (const ruim of [undefined, '', 'curta', Buffer.alloc(16).toString('base64')]) {
    assert.throws(() => chaveCredenciais(ruim), /CREDENCIAIS_CHAVE/);
  }
});
