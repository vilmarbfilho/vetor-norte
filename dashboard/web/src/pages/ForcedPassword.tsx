// Shown instead of the app while the user still has the temporary password an admin generated.
// The server blocks every other route until the password is changed (403 troca_senha_obrigatoria).
import { useState, type FormEvent } from 'react';
import { api, type Usuario } from '../api';
import { Alerta, useMensagemErro } from '../components/ui';
import { SeletorIdioma } from '../components/Layout';
import { useIdioma, type Idioma } from '../i18n';

export function TrocaSenhaObrigatoria({ usuario, aoConcluir, aoSair, aoMudarIdioma }: {
  usuario: Usuario; aoConcluir: (u: Usuario) => void; aoSair: () => void; aoMudarIdioma: (i: Idioma) => void;
}) {
  const { t } = useIdioma();
  const mensagemErro = useMensagemErro();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    if (nova !== confirmacao) return setErro(t('conta.senhasDiferentes'));
    setSalvando(true);
    try {
      await api.alterarSenha(atual, nova);
      aoConcluir((await api.eu()).usuario);
    } catch (err) {
      setErro(mensagemErro(err));
      setSalvando(false);
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
          <SeletorIdioma aoMudar={aoMudarIdioma} />
        </div>
        <h1>{t('trocaSenha.titulo')}</h1>
        <Alerta tom="info">{t('trocaSenha.texto', { nome: usuario.nome })}</Alerta>
        <Alerta>{erro}</Alerta>
        <input type="email" autoComplete="username" value={usuario.email} readOnly hidden />
        <label className="campo"><span>{t('trocaSenha.temporaria')}</span>
          <input type="password" autoComplete="current-password" required value={atual} onChange={(e) => setAtual(e.target.value)} autoFocus /></label>
        <label className="campo"><span>{t('conta.novaSenha')}</span>
          <input type="password" autoComplete="new-password" required minLength={10} value={nova} onChange={(e) => setNova(e.target.value)} /></label>
        <label className="campo"><span>{t('conta.confirmarSenha')}</span>
          <input type="password" autoComplete="new-password" required minLength={10} value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} /></label>
        <small className="sutil">{t('trocaSenha.ajuda')}</small>
        <button type="submit" className="botao botao-primario largo" disabled={salvando}>
          {salvando ? t('comum.salvando') : t('trocaSenha.salvar')}
        </button>
        <button type="button" className="botao-link" onClick={aoSair}>{t('nav.sair')}</button>
      </form>
    </div>
  );
}
