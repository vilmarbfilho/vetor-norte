import { useState, type FormEvent } from 'react';
import { api, type Usuario } from '../api';
import { Alerta, useMensagemErro } from '../components/ui';
import { SeletorIdioma } from '../components/Layout';
import { useIdioma } from '../i18n';

export function Login({ aoEntrar, aviso }: { aoEntrar: (u: Usuario) => void; aviso?: string }) {
  const { t, definirIdioma } = useIdioma();
  const mensagemErro = useMensagemErro();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro('');
    try {
      const { usuario } = await api.login(email, senha);
      aoEntrar(usuario);
    } catch (err) {
      setErro(mensagemErro(err));
      setSenha('');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="tela-login">
      <form className="cartao login" onSubmit={enviar}>
        <div className="login-topo">
          <div className="marca">
            <img src="/favicon.svg" alt="" width={32} height={32} />
            <div>
              <strong>{t('app.nome')}</strong>
              <span>{t('app.subtitulo')}</span>
            </div>
          </div>
          <SeletorIdioma aoMudar={definirIdioma} />
        </div>
        <h1>{t('login.titulo')}</h1>
        {aviso && <Alerta tom="info">{aviso}</Alerta>}
        <Alerta>{erro}</Alerta>
        <label className="campo">
          <span>{t('login.email')}</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="campo">
          <span>{t('login.senha')}</span>
          <input type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        <button type="submit" className="botao botao-primario largo" disabled={enviando}>
          {enviando ? t('login.entrando') : t('login.entrar')}
        </button>
      </form>
    </div>
  );
}
