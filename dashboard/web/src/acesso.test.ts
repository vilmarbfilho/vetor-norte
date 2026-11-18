import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginasDe, podeAcessar, tetoPermissoes } from './acesso';

const corretor = { perfil: 'corretor' as const, telas: ['downloads' as const], permissoesApi: ['pdf:baixar' as const] };
const admin = { perfil: 'admin' as const, telas: [], permissoesApi: [] };

test('menu por perfil: admin vê tudo; corretor só o liberado + minha conta', () => {
  assert.deepEqual(paginasDe(admin).map((p) => p.caminho), ['/logs', '/consultas', '/downloads', '/chaves', '/usuarios', '/credenciais', '/conta']);
  assert.deepEqual(paginasDe(corretor).map((p) => p.caminho), ['/downloads', '/credenciais', '/conta']);
  assert.equal(podeAcessar(corretor, 'admin'), false);
});

test('teto de permissões: admin sem limite; corretor só o liberado', () => {
  assert.deepEqual(tetoPermissoes(admin), ['protocolos:listar', 'pdf:baixar', 'pdf:enviar']);
  assert.deepEqual(tetoPermissoes(corretor), ['pdf:baixar']);
});
