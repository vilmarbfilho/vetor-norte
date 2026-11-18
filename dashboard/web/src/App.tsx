// Root: loads the session, shows Login or the app, routes between pages, syncs the language.
import { useCallback, useEffect, useState } from 'react';
import { api, EVENTO_SESSAO_EXPIRADA, type Usuario } from './api';
import { Carregando } from './components/ui';
import { Layout } from './components/Layout';
import { useIdioma, type Idioma } from './i18n';
import { Conta } from './pages/Account';
import { Downloads } from './pages/Downloads';
import { Chaves } from './pages/Keys';
import { Login } from './pages/Login';
import { Logs } from './pages/Logs';
import { useRota } from './router';

export function App() {
  const { t, definirIdioma } = useIdioma();
  const { caminho, navegar } = useRota();
  // undefined = still checking the session; null = signed out.
  const [usuario, setUsuario] = useState<Usuario | null | undefined>(undefined);
  const [aviso, setAviso] = useState('');

  const entrar = useCallback((u: Usuario) => {
    setUsuario(u);
    setAviso('');
    definirIdioma(u.idioma); // the account's language wins after login
  }, [definirIdioma]);

  useEffect(() => {
    api.eu().then(({ usuario: u }) => entrar(u)).catch(() => setUsuario(null));
  }, [entrar]);

  useEffect(() => {
    const expirou = () => {
      setUsuario((atual) => {
        if (atual) setAviso(t('erro.nao_autenticado'));
        return null;
      });
    };
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, expirou);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, expirou);
  }, [t]);

  // "/" and unknown paths go to the first page.
  useEffect(() => {
    if (usuario && !['/logs', '/downloads', '/chaves', '/conta'].includes(caminho)) navegar('/logs', { substituir: true });
  }, [usuario, caminho, navegar]);

  const mudarIdioma = (i: Idioma) => {
    definirIdioma(i);
    if (usuario) {
      setUsuario({ ...usuario, idioma: i });
      api.definirIdioma(i).catch(() => {}); // the UI already switched; failing to save is not critical
    }
  };

  const sair = async () => {
    await api.logout().catch(() => {});
    setUsuario(null);
  };

  if (usuario === undefined) return <Carregando />;
  if (!usuario) return <Login aoEntrar={entrar} aviso={aviso} />;

  return (
    <Layout usuario={usuario} aoSair={sair} aoMudarIdioma={mudarIdioma}>
      {caminho === '/downloads' ? <Downloads key={caminho} />
        : caminho === '/chaves' ? <Chaves />
        : caminho === '/conta' ? <Conta usuario={usuario} aoMudarIdioma={mudarIdioma} />
        : <Logs key={caminho} />}
    </Layout>
  );
}
