// Small shared UI pieces: modal, pagination, badges, error message, copy button.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ErroApi } from '../api';
import { useIdioma } from '../i18n';
import { chaveValida } from '../i18n/translate';

/** Accessible modal on top of the native <dialog> (focus trap, Esc to close). */
export function Modal({ titulo, aberto, aoFechar, children, rodape }: {
  titulo: string; aberto: boolean; aoFechar: () => void; children: ReactNode; rodape?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);
  return (
    <dialog ref={ref} className="modal" onClose={aoFechar} aria-labelledby="modal-titulo">
      <div className="modal-cabecalho">
        <h2 id="modal-titulo">{titulo}</h2>
        <button type="button" className="botao-icone" onClick={aoFechar} aria-label="×">×</button>
      </div>
      <div className="modal-corpo">{aberto && children}</div>
      {rodape && <div className="modal-rodape">{rodape}</div>}
    </dialog>
  );
}

export function Paginacao({ pagina, porPagina, total, aoMudar }: {
  pagina: number; porPagina: number; total: number; aoMudar: (p: number) => void;
}) {
  const { t } = useIdioma();
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  return (
    <nav className="paginacao" aria-label="pagination">
      <span>{t('comum.paginacao', { pagina, paginas, total })}</span>
      <div className="paginacao-botoes">
        <button type="button" className="botao" disabled={pagina <= 1} onClick={() => aoMudar(pagina - 1)}>{t('comum.anterior')}</button>
        <button type="button" className="botao" disabled={pagina >= paginas} onClick={() => aoMudar(pagina + 1)}>{t('comum.proxima')}</button>
      </div>
    </nav>
  );
}

export type Tom = 'sucesso' | 'aviso' | 'erro' | 'neutro' | 'info';

export function Selo({ tom, children }: { tom: Tom; children: ReactNode }) {
  return <span className={`selo selo-${tom}`}>{children}</span>;
}

/** Translated message for any error thrown by the api client. */
export function useMensagemErro() {
  const { t } = useIdioma();
  return (erro: unknown): string => {
    if (!(erro instanceof ErroApi)) return t('erro.generico');
    const chave = `erro.${erro.codigo}`;
    if (!chaveValida(chave)) return t('erro.generico');
    const segundos = Number(erro.dados.tenteNovamenteEmSegundos ?? 0);
    return t(chave, { minutos: Math.max(1, Math.ceil(segundos / 60)), minimo: Number(erro.dados.minimo ?? 10) });
  };
}

export function Alerta({ tom = 'erro', children }: { tom?: 'erro' | 'sucesso' | 'info'; children: ReactNode }) {
  if (!children) return null;
  return <div className={`alerta alerta-${tom}`} role={tom === 'erro' ? 'alert' : 'status'}>{children}</div>;
}

export function BotaoCopiar({ texto }: { texto: string }) {
  const { t } = useIdioma();
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Clipboard blocked (e.g. plain http): the text is still selectable on screen.
    }
  };
  return <button type="button" className="botao" onClick={copiar}>{copiado ? t('comum.copiado') : t('comum.copiar')}</button>;
}

export function Carregando() {
  const { t } = useIdioma();
  return <p className="vazio">{t('comum.carregando')}</p>;
}

export function CabecalhoPagina({ titulo, descricao, acao }: { titulo: string; descricao: string; acao?: ReactNode }) {
  return (
    <header className="cabecalho-pagina">
      <div>
        <h1>{titulo}</h1>
        <p className="descricao">{descricao}</p>
      </div>
      {acao}
    </header>
  );
}
