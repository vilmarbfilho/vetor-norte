// Pure translation helpers (no React), so they can be unit-tested in Node.
import { en, type ChaveTexto } from './en';
import { pt } from './pt';

export type Idioma = 'pt' | 'en';
export const DICIONARIOS: Record<Idioma, Record<ChaveTexto, string>> = { en, pt };

/** Replaces {name} placeholders; unknown placeholders are left as they are (e.g. "{n}" in route help). */
export function formatar(texto: string, params: Record<string, string | number> = {}): string {
  return texto.replace(/\{(\w+)\}/g, (inteiro, nome: string) => (nome in params ? String(params[nome]) : inteiro));
}

export function traduzir(idioma: Idioma, chave: ChaveTexto, params?: Record<string, string | number>): string {
  return formatar(DICIONARIOS[idioma][chave] ?? en[chave], params);
}

export function chaveValida(chave: string): chave is ChaveTexto {
  return chave in en;
}
