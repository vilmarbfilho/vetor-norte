// Shared logic of the list pages: filters live in the URL (?de=...&pagina=2), so reload, back button
// and links (e.g. "downloads of this key") keep them.
import { useCallback, useEffect, useState } from 'react';
import type { Pagina } from '../api';
import { consultaDaApi } from '../format';
import { useRota } from '../router';

export function useListagem<T>(buscar: (q: URLSearchParams) => Promise<Pagina<T>>) {
  const { caminho, busca, navegar } = useRota();
  const [dados, setDados] = useState<Pagina<T> | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [carregando, setCarregando] = useState(true);
  const chave = busca.toString();

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro(null);
    buscar(consultaDaApi(new URLSearchParams(chave)))
      .then((d) => ativo && setDados(d))
      .catch((e) => ativo && setErro(e))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [chave, buscar]);

  /** Applies new filters (back to page 1). */
  const filtrar = useCallback(
    (filtros: Record<string, string>) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(filtros)) if (v) q.set(k, v);
      navegar(`${caminho}${q.size ? `?${q}` : ''}`);
    },
    [caminho, navegar],
  );

  const irParaPagina = useCallback(
    (pagina: number) => {
      const q = new URLSearchParams(chave);
      q.set('pagina', String(pagina));
      navegar(`${caminho}?${q}`);
    },
    [caminho, chave, navegar],
  );

  return { dados, erro, carregando, filtros: new URLSearchParams(chave), filtrar, irParaPagina };
}

/** Form state for filters, initialized from the URL. */
export function valoresIniciais(filtros: URLSearchParams, campos: string[]): Record<string, string> {
  return Object.fromEntries(campos.map((c) => [c, filtros.get(c) ?? '']));
}
