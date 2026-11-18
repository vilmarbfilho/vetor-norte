// Which pages a user sees. Mirrors server/auth/access.ts (the server enforces it; this only shapes the UI).
// Kept separate because web/ must not import runtime code from server/.
import type { Permissao, Tela, Usuario } from './api';
import type { ChaveTexto } from './i18n/en';

export type Acesso = 'todos' | 'admin' | Tela;

export const TODAS_PERMISSOES: Permissao[] = ['protocolos:listar', 'pdf:baixar', 'pdf:enviar'];

export function ehAdmin(u: Pick<Usuario, 'perfil'>): boolean {
  return u.perfil === 'admin';
}

export function podeAcessar(u: Pick<Usuario, 'perfil' | 'telas'>, acesso: Acesso): boolean {
  if (acesso === 'todos' || ehAdmin(u)) return true;
  if (acesso === 'admin') return false;
  return u.telas.includes(acesso);
}

/** API permissions a user's keys may hold (admins: all). */
export function tetoPermissoes(u: Pick<Usuario, 'perfil' | 'permissoesApi'>): Permissao[] {
  return ehAdmin(u) ? TODAS_PERMISSOES : TODAS_PERMISSOES.filter((p) => u.permissoesApi.includes(p));
}

export interface Pagina {
  caminho: string;
  texto: ChaveTexto;
  acesso: Acesso;
}

/** Menu order. The first page the user may open is their home page. */
export const PAGINAS: Pagina[] = [
  { caminho: '/logs', texto: 'nav.logs', acesso: 'admin' },
  { caminho: '/consultas', texto: 'nav.consultas', acesso: 'consultas' },
  { caminho: '/downloads', texto: 'nav.downloads', acesso: 'downloads' },
  { caminho: '/chaves', texto: 'nav.chaves', acesso: 'chaves' },
  { caminho: '/usuarios', texto: 'nav.usuarios', acesso: 'admin' },
  { caminho: '/credenciais', texto: 'nav.credenciais', acesso: 'todos' },
  { caminho: '/conta', texto: 'nav.conta', acesso: 'todos' },
];

export function paginasDe(u: Pick<Usuario, 'perfil' | 'telas'>): Pagina[] {
  return PAGINAS.filter((p) => podeAcessar(u, p.acesso));
}
