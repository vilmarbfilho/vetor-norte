// Password hashing and login throttling (pure, no DB).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gerarChaveApi } from './api-keys.ts';
import { BloqueioLogin } from './login-throttle.ts';
import { hashSenha, verificarSenha } from './passwords.ts';
import { gerarToken, hashToken } from './tokens.ts';

test('scrypt: verifica a senha certa, recusa a errada e formatos inválidos', async () => {
  const h = await hashSenha('senha-muito-segura');
  assert.match(h, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await verificarSenha('senha-muito-segura', h), true);
  assert.equal(await verificarSenha('senha-errada', h), false);
  assert.equal(await verificarSenha('x', 'bcrypt$abc'), false);
  assert.notEqual(await hashSenha('senha-muito-segura'), h); // random salt
});

test('tokens e chaves: formato e hash', () => {
  const { token, hash } = gerarToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashToken(token), hash);
  const k = gerarChaveApi();
  assert.match(k.chave, /^vn_[A-Za-z0-9_-]{43}$/);
  assert.equal(k.prefixo, k.chave.slice(0, 11));
  assert.match(k.hash, /^[0-9a-f]{64}$/);
});

test('bloqueio de login: após N falhas bloqueia, expira e é por e-mail', () => {
  let agora = 0;
  const b = new BloqueioLogin(3, 15 * 60_000, () => agora);
  b.registrarFalha('A@x.com');
  b.registrarFalha('a@x.com ');
  assert.equal(b.bloqueadoPor('a@x.com'), 0);
  b.registrarFalha('a@x.com');
  assert.equal(b.bloqueadoPor('a@x.com'), 15 * 60_000);
  assert.equal(b.bloqueadoPor('outro@x.com'), 0);
  agora += 15 * 60_000;
  assert.equal(b.bloqueadoPor('a@x.com'), 0);
  // An old failure streak is forgotten: a single new failure does not block again.
  b.registrarFalha('a@x.com');
  assert.equal(b.bloqueadoPor('a@x.com'), 0);
});

test('bloqueio de login: sucesso zera as falhas', () => {
  const b = new BloqueioLogin(2, 60_000);
  b.registrarFalha('a@x.com');
  b.registrarSucesso('a@x.com');
  b.registrarFalha('a@x.com');
  assert.equal(b.bloqueadoPor('a@x.com'), 0);
});
