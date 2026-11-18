// Broker portal credentials: the account the API uses to log in to the portal for this user.
// The saved password is never shown (the server never returns it); typing a new one replaces it.
import { useState, type FormEvent } from 'react';
import { api, type DadosCredencial, type ResumoCredencial, type StatusCredencial } from '../api';
import { Alerta, CabecalhoPagina, Carregando, Selo, useMensagemErro, type Tom } from '../components/ui';
import { formatarDataHora } from '../format';
import { useIdioma } from '../i18n';

export const TOM_CREDENCIAL: Record<StatusCredencial, Tom> = { valida: 'sucesso', invalida: 'erro', nao_testada: 'aviso' };

/** Status badge; `null` = not registered. */
export function SeloCredencial({ credencial }: { credencial: ResumoCredencial | null }) {
  const { t } = useIdioma();
  if (!credencial) return <Selo tom="neutro">{t('credenciais.status.ausente')}</Selo>;
  return <Selo tom={TOM_CREDENCIAL[credencial.status]}>{t(`credenciais.status.${credencial.status}`)}</Selo>;
}

/** Status details (when, by whom). */
export function DetalhesCredencial({ credencial }: { credencial: ResumoCredencial }) {
  const { t, locale } = useIdioma();
  return (
    <dl className="detalhes">
      <dt>{t('credenciais.emailPortal')}</dt><dd>{credencial.emailPortal}</dd>
      <dt>{t('chaves.status')}</dt><dd><SeloCredencial credencial={credencial} /></dd>
      <dt>{t('credenciais.atualizada')}</dt>
      <dd>
        {formatarDataHora(credencial.atualizadaEm, locale)}
        {credencial.atualizadaPor && <span className="sutil"> · {t('chaves.por', { nome: credencial.atualizadaPor.nome })}</span>}
      </dd>
      <dt>{t('credenciais.ultimoLoginOk')}</dt>
      <dd>{credencial.ultimoLoginOkEm ? formatarDataHora(credencial.ultimoLoginOkEm, locale) : <span className="sutil">{t('chaves.nunca')}</span>}</dd>
      {credencial.invalidadaEm && (<><dt>{t('credenciais.invalidadaEm')}</dt><dd>{formatarDataHora(credencial.invalidadaEm, locale)}</dd></>)}
    </dl>
  );
}

/** E-mail + password form. The password field always starts empty. */
export function FormularioCredencial({ emailInicial, aoSalvar, aoCancelar }: {
  emailInicial: string; aoSalvar: (c: DadosCredencial) => Promise<void>; aoCancelar?: () => void;
}) {
  const { t } = useIdioma();
  const mensagemErro = useMensagemErro();
  const [emailPortal, setEmailPortal] = useState(emailInicial);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      await aoSalvar({ emailPortal: emailPortal.trim(), senha });
      setSenha('');
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="formulario">
      <Alerta>{erro}</Alerta>
      <label className="campo">
        <span>{t('credenciais.emailPortal')}</span>
        {/* autocomplete off: these are not the dashboard's own credentials. */}
        <input type="email" required maxLength={200} autoComplete="off" value={emailPortal} onChange={(e) => setEmailPortal(e.target.value)} />
      </label>
      <label className="campo">
        <span>{t('credenciais.senhaPortal')}</span>
        <input type="password" required maxLength={200} autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        <small className="sutil">{t('credenciais.senhaAjuda')}</small>
      </label>
      <div className={aoCancelar ? 'modal-rodape' : undefined}>
        {aoCancelar && <button type="button" className="botao" onClick={aoCancelar}>{t('comum.cancelar')}</button>}
        <button type="submit" className="botao botao-primario" disabled={salvando || !senha || !emailPortal.trim()}>
          {salvando ? t('comum.salvando') : t('comum.salvar')}
        </button>
      </div>
    </form>
  );
}

/** `credencial`: loaded by App (it also drives the warning banner); undefined = loading. */
export function Credenciais({ credencial, aoSalvar }: {
  credencial: ResumoCredencial | null | undefined; aoSalvar: (c: ResumoCredencial) => void;
}) {
  const { t } = useIdioma();
  const [ok, setOk] = useState('');

  return (
    <>
      <CabecalhoPagina titulo={t('credenciais.titulo')} descricao={t('credenciais.descricao')} />
      {credencial === undefined ? <Carregando /> : (
        <div className="grade-conta">
          <section className="cartao">
            <h2>{t('credenciais.situacao')}</h2>
            {credencial?.status === 'invalida' && <Alerta>{t('credenciais.avisoInvalida')}</Alerta>}
            {credencial ? <DetalhesCredencial credencial={credencial} /> : <p className="sutil">{t('credenciais.nenhuma')}</p>}
          </section>
          <section className="cartao">
            <h2>{t(credencial ? 'credenciais.atualizar' : 'credenciais.cadastrar')}</h2>
            <Alerta tom="sucesso">{ok}</Alerta>
            <FormularioCredencial
              emailInicial={credencial?.emailPortal ?? ''}
              aoSalvar={async (c) => {
                setOk('');
                const r = await api.salvarCredencial(c);
                aoSalvar(r.credencial);
                setOk(t('credenciais.salva'));
              }}
            />
          </section>
        </div>
      )}
    </>
  );
}
