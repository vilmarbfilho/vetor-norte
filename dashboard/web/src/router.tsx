// Minimal client-side router (5 pages do not need a router library): History API + popstate.
import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from 'react';

interface Rota {
  caminho: string;
  busca: URLSearchParams;
  navegar: (url: string, opcoes?: { substituir?: boolean }) => void;
}

const Contexto = createContext<Rota | null>(null);

function lerLocal() {
  return { caminho: window.location.pathname, busca: new URLSearchParams(window.location.search) };
}

export function ProvedorRota({ children }: { children: ReactNode }) {
  const [local, setLocal] = useState(lerLocal);
  useEffect(() => {
    const aoVoltar = () => setLocal(lerLocal());
    window.addEventListener('popstate', aoVoltar);
    return () => window.removeEventListener('popstate', aoVoltar);
  }, []);
  const navegar = (url: string, opcoes: { substituir?: boolean } = {}) => {
    if (opcoes.substituir) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    setLocal(lerLocal());
    window.scrollTo(0, 0);
  };
  return <Contexto.Provider value={{ ...local, navegar }}>{children}</Contexto.Provider>;
}

export function useRota(): Rota {
  const r = useContext(Contexto);
  if (!r) throw new Error('useRota fora do ProvedorRota');
  return r;
}

/** <a> that navigates without reloading (keeps middle-click / ctrl-click working). */
export function Link({ para, children, className, ...resto }: { para: string; children: ReactNode; className?: string; 'aria-current'?: 'page' }) {
  const { navegar } = useRota();
  const aoClicar = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navegar(para);
  };
  return (
    <a href={para} onClick={aoClicar} className={className} {...resto}>
      {children}
    </a>
  );
}
