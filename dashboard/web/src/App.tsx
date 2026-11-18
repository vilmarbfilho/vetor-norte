// Root: loads the session, shows Login (or the forced password change) or the app, routes between the pages
// the user's profile allows, syncs the language.
import { useCallback, useEffect, useState } from 'react';
import { ehAdmin, paginasDe } from './acesso';
import { api, EVENTO_SESSAO_EXPIRADA, type ResumoCredencial, type Usuario } from './api';
import { Carregando } from './components/ui';
import { Layout } from './components/Layout';
import { useIdioma, type Idioma } from './i18n';
import { Conta } from './pages/Account';
import { Credenciais } from './pages/Credentials';
import { Downloads } from './pages/Downloads';
import { Consultas } from './pages/Queries';
import { TrocaSenhaObrigatoria } from './pages/ForcedPassword';
import { Chaves } from './pages/Keys';
import { Login } from './pages/Login';
import { Logs } from './pages/Logs';
import { Usuarios } from './pages/Users';
import { Link, useRota } from './router';
import { ProvedorUsuario } from './sessao';

export function App() {
  const { t, definirIdioma } = useIdioma();
  const { caminho, navegar } = useRota();
  // undefined = still checking the session; null = signed out.
  const [usuario, setUsuario] = useState<Usuario | null | undefined>(undefined);
  const [aviso, setAviso] = useState('');
  // Own portal credentials: shown on their page and in a warning banner when missing/invalid.
  const [credencial, setCredencial] = useState<ResumoCredencial | null | undefined>(undefined);
  const prontoParaUsar = Boolean(usuario && !usuario.trocarSenha);
  useEffect(() => {
    if (!prontoParaUsar) return setCredencial(undefined);
    api.credencial().then((r) => setCredencial(r.credencial)).catch(() => setCredencial(undefined));
  }, [prontoParaUsar, usuario?.id]);

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

  // "/", unknown paths and pages this profile cannot open go to the user's first page.
  const paginas = usuario ? paginasDe(usuario) : [];
  const permitida = paginas.some((p) => p.caminho === caminho);
  const inicio = paginas[0]?.caminho ?? '/conta';
  useEffect(() => {
    if (usuario && !usuario.trocarSenha && !permitida) navegar(inicio, { substituir: true });
  }, [usuario, permitida, inicio, navegar]);

  /** Re-reads the session and own portal credentials (an admin changed them on the Users page). */
  const recarregarUsuario = useCallback(() => {
    api.eu().then(({ usuario: u }) => setUsuario(u)).catch(() => {});
    api.credencial().then((r) => setCredencial(r.credencial)).catch(() => {});
  }, []);

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
  if (usuario.trocarSenha) {
    return <TrocaSenhaObrigatoria usuario={usuario} aoConcluir={entrar} aoSair={sair} aoMudarIdioma={mudarIdioma} />;
  }
  if (!permitida) return <Carregando />; // redirecting (effect above)

  // Admins may have no portal account (optional); for a corretor a missing one means the API cannot work.
  const avisoCredencial = caminho === '/credenciais' ? null
    : credencial?.status === 'invalida' ? 'credenciais.bannerInvalida'
    : credencial === null && !ehAdmin(usuario) ? 'credenciais.bannerAusente'
    : null;

  return (
    <ProvedorUsuario value={usuario}>
      <Layout
        usuario={usuario} paginas={paginas} aoSair={sair} aoMudarIdioma={mudarIdioma}
        aviso={avisoCredencial && (
          <div className="alerta alerta-erro faixa">
            <span>{t(avisoCredencial)}</span>
            <Link para="/credenciais" className="botao-link">{t('credenciais.bannerAcao')}</Link>
          </div>
        )}
      >
        {caminho === '/consultas' ? <Consultas key={caminho} />
          : caminho === '/downloads' ? <Downloads key={caminho} />
          : caminho === '/chaves' ? <Chaves />
          : caminho === '/usuarios' ? <Usuarios aoAlterarProprio={recarregarUsuario} />
          : caminho === '/credenciais' ? <Credenciais credencial={credencial} aoSalvar={setCredencial} />
          : caminho === '/conta' ? <Conta usuario={usuario} aoMudarIdioma={mudarIdioma} />
          : <Logs key={caminho} />}
      </Layout>
    </ProvedorUsuario>
  );
}
