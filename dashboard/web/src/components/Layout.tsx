// App shell: side navigation (top bar on small screens), language selector, sign out.
import type { ReactNode } from 'react';
import type { Usuario } from '../api';
import { useIdioma, type Idioma } from '../i18n';
import type { ChaveTexto } from '../i18n/en';
import { Link, useRota } from '../router';

const ITENS: { caminho: string; texto: ChaveTexto }[] = [
  { caminho: '/logs', texto: 'nav.logs' },
  { caminho: '/consultas', texto: 'nav.consultas' },
  { caminho: '/downloads', texto: 'nav.downloads' },
  { caminho: '/chaves', texto: 'nav.chaves' },
  { caminho: '/conta', texto: 'nav.conta' },
];

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

export function Layout({ usuario, aoSair, aoMudarIdioma, children }: {
  usuario: Usuario; aoSair: () => void; aoMudarIdioma: (i: Idioma) => void; children: ReactNode;
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
          {ITENS.map((i) => (
            <Link key={i.caminho} para={i.caminho} className="menu-item" aria-current={caminho === i.caminho ? 'page' : undefined}>
              {t(i.texto)}
            </Link>
          ))}
        </nav>
        <div className="lateral-rodape">
          <SeletorIdioma aoMudar={aoMudarIdioma} />
          <div className="usuario">
            <span title={usuario.email}>{usuario.nome}</span>
            <button type="button" className="botao-link" onClick={aoSair}>{t('nav.sair')}</button>
          </div>
        </div>
      </aside>
      <main className="conteudo">{children}</main>
    </div>
  );
}
