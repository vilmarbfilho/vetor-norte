// Language context. Before login the choice lives in localStorage (per browser); after login the
// user's saved language (usuarios.idioma) wins and changes are saved to the account.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChaveTexto } from './en';
import { traduzir, type Idioma } from './translate';

export type { Idioma } from './translate';
export type Traduzir = (chave: ChaveTexto, params?: Record<string, string | number>) => string;

const CHAVE_LOCAL = 'vn_idioma';
const PADRAO: Idioma = 'en';

function idiomaSalvo(): Idioma {
  try {
    const v = localStorage.getItem(CHAVE_LOCAL);
    return v === 'pt' || v === 'en' ? v : PADRAO;
  } catch {
    return PADRAO; // storage blocked (private mode): fall back to the default
  }
}

interface ContextoIdioma {
  idioma: Idioma;
  definirIdioma: (i: Idioma) => void;
  t: Traduzir;
  /** Locale for Intl formatting. */
  locale: string;
}

const Contexto = createContext<ContextoIdioma | null>(null);

export function ProvedorIdioma({ children }: { children: ReactNode }) {
  const [idioma, setIdioma] = useState<Idioma>(idiomaSalvo);
  const definirIdioma = useCallback((i: Idioma) => {
    setIdioma(i);
    try {
      localStorage.setItem(CHAVE_LOCAL, i);
    } catch {
      // not persisted: fine, the account keeps it after login
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = idioma === 'pt' ? 'pt-BR' : 'en';
  }, [idioma]);
  const valor = useMemo<ContextoIdioma>(
    () => ({ idioma, definirIdioma, t: (c, p) => traduzir(idioma, c, p), locale: idioma === 'pt' ? 'pt-BR' : 'en-US' }),
    [idioma, definirIdioma],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useIdioma(): ContextoIdioma {
  const c = useContext(Contexto);
  if (!c) throw new Error('useIdioma fora do ProvedorIdioma');
  return c;
}
