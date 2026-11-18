// Profiles and access rules. Pure functions, shared by routes and tests.
//
// - admin: everything (all screens, all API permissions, every user's data).
// - corretor: only the screens in `telas`, only their own data, and API keys limited to `permissoesApi`.
// Screens not listed in TELAS are fixed: Errors and Users are admin-only; My account and Portal
// credentials are available to everyone.

import { PERMISSOES, type Permissao } from './api-keys.ts';

export const PERFIS = ['admin', 'corretor'] as const;
export type Perfil = (typeof PERFIS)[number];

/** Screens an admin can grant to a corretor. Must match the CHECK constraint `usuarios_telas_validas`. */
export const TELAS = ['downloads', 'consultas', 'chaves'] as const;
export type Tela = (typeof TELAS)[number];

/** Who may call a dashboard route. Every protected /api route must declare one (checked at startup). */
export type Acesso = 'todos' | 'admin' | Tela;

export interface Permissionado {
  perfil: Perfil;
  telas: readonly Tela[];
  permissoesApi: readonly Permissao[];
}

export function ehAdmin(u: Pick<Permissionado, 'perfil'>): boolean {
  return u.perfil === 'admin';
}

export function podeAcessar(u: Permissionado, acesso: Acesso): boolean {
  if (acesso === 'todos' || ehAdmin(u)) return true;
  if (acesso === 'admin') return false;
  return u.telas.includes(acesso);
}

/** API permissions this user's keys may hold (admins: all). */
export function tetoPermissoes(u: Permissionado): Permissao[] {
  return ehAdmin(u) ? [...PERMISSOES] : PERMISSOES.filter((p) => u.permissoesApi.includes(p));
}

/** Requested permissions outside the owner's ceiling (empty = allowed). */
export function permissoesForaDoTeto(dono: Permissionado, pedidas: readonly Permissao[]): Permissao[] {
  const teto = tetoPermissoes(dono);
  return pedidas.filter((p) => !teto.includes(p));
}
