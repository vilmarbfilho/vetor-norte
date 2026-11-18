// App shell: side navigation (top bar on small screens), language selector, sign out.
import type { ReactNode } from 'react';
import type { Pagina } from '../acesso';
import type { Usuario } from '../api';
import { useIdioma, type Idioma } from '../i18n';
import { Link, useRota } from '../router';

export function SeletorIdioma({ aoMudar }: { aoMudar: (i: Idioma) => void }) {
  const { idioma, t } = useIdioma();
  return (
    <label className="seletor-idioma">
      <span className="visualmente-oculto">{t('idioma.rotulo')}</span>
      <select value={idioma} onChange={(e) => aoMudar(e.target.value as Idioma)}>
        <option value="en">{t('idioma.en')}</option>
        <option value="pt">{t('idioma.pt')}</option>
      </select>
    </label>
  );
}

/** `paginas`: only the pages this user's profile allows (see acesso.ts). */
export function Layout({ usuario, paginas, aoSair, aoMudarIdioma, aviso, children }: {
  usuario: Usuario; paginas: Pagina[]; aoSair: () => void; aoMudarIdioma: (i: Idioma) => void;
  /** Banner above every page (e.g. invalid portal credentials). */
  aviso?: ReactNode; children: ReactNode;
}) {
  const { t } = useIdioma();
  const { caminho } = useRota();
  return (
    <div className="shell">
      <aside className="lateral">
        <div className="marca">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <div>
            <strong>{t('app.nome')}</strong>
            <span>{t('app.subtitulo')}</span>
          </div>
        </div>
        <nav className="menu">
          {paginas.map((i) => (
            <Link key={i.caminho} para={i.caminho} className="menu-item" aria-current={caminho === i.caminho ? 'page' : undefined}>
              {t(i.texto)}
            </Link>
          ))}
        </nav>
        <div className="lateral-rodape">
          <SeletorIdioma aoMudar={aoMudarIdioma} />
          <div className="usuario">
            <span title={`${usuario.email} · ${t(`perfil.${usuario.perfil}`)}`}>{usuario.nome}</span>
            <button type="button" className="botao-link" onClick={aoSair}>{t('nav.sair')}</button>
          </div>
        </div>
      </aside>
      <main className="conteudo">{aviso}{children}</main>
    </div>
  );
}
