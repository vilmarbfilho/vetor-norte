import { useState, type FormEvent } from 'react';
import { api, type Usuario } from '../api';
import { Alerta, CabecalhoPagina, useMensagemErro } from '../components/ui';
import { SeletorIdioma } from '../components/Layout';
import { useIdioma, type Idioma } from '../i18n';

export function Conta({ usuario, aoMudarIdioma }: { usuario: Usuario; aoMudarIdioma: (i: Idioma) => void }) {
  const { t } = useIdioma();
  const mensagemErro = useMensagemErro();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [salvando, setSalvando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    setOk('');
    if (nova !== confirmacao) return setErro(t('conta.senhasDiferentes'));
    setSalvando(true);
    try {
      await api.alterarSenha(atual, nova);
      setOk(t('conta.senhaAlterada'));
      setAtual('');
      setNova('');
      setConfirmacao('');
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <CabecalhoPagina titulo={t('conta.titulo')} descricao={usuario.email} />
      <div className="grade-conta">
        <section className="cartao">
          <dl className="detalhes">
            <dt>{t('conta.nome')}</dt><dd>{usuario.nome}</dd>
            <dt>{t('conta.email')}</dt><dd>{usuario.email}</dd>
            <dt>{t('usuarios.perfil')}</dt><dd>{t(`perfil.${usuario.perfil}`)}</dd>
            <dt>{t('idioma.rotulo')}</dt>
            <dd><SeletorIdioma aoMudar={aoMudarIdioma} /> <small className="sutil">{t('conta.idiomaAjuda')}</small></dd>
          </dl>
        </section>
        <section className="cartao">
          <h2>{t('conta.senhaTitulo')}</h2>
          <form onSubmit={enviar} className="formulario">
            <Alerta>{erro}</Alerta>
            <Alerta tom="sucesso">{ok}</Alerta>
            {/* Hidden username helps password managers associate the new password with the account. */}
            <input type="email" autoComplete="username" value={usuario.email} readOnly hidden />
            <label className="campo"><span>{t('conta.senhaAtual')}</span>
              <input type="password" autoComplete="current-password" required value={atual} onChange={(e) => setAtual(e.target.value)} /></label>
            <label className="campo"><span>{t('conta.novaSenha')}</span>
              <input type="password" autoComplete="new-password" required minLength={10} value={nova} onChange={(e) => setNova(e.target.value)} /></label>
            <label className="campo"><span>{t('conta.confirmarSenha')}</span>
              <input type="password" autoComplete="new-password" required minLength={10} value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} /></label>
            <small className="sutil">{t('conta.senhaAjuda')}</small>
            <div><button type="submit" className="botao botao-primario" disabled={salvando}>{salvando ? t('comum.salvando') : t('comum.salvar')}</button></div>
          </form>
        </section>
      </div>
    </>
  );
}
