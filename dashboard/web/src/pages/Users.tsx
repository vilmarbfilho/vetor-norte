// User management (admins only): create, edit profile/screens/API ceiling, (de)activate, reset password.
// Temporary passwords are kept only in memory and dropped when their modal closes.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type DadosUsuario, type Perfil, type Permissao, type Tela, type UsuarioResumo } from '../api';
import { TODAS_PERMISSOES } from '../acesso';
import { Alerta, BotaoCopiar, CabecalhoPagina, Carregando, Modal, Selo, useMensagemErro } from '../components/ui';
import { formatarDataHora } from '../format';
import { useIdioma } from '../i18n';
import { Link } from '../router';
import { useUsuarioAtual } from '../sessao';
import { DetalhesCredencial, FormularioCredencial, SeloCredencial } from './Credentials';

const TELAS: Tela[] = ['consultas', 'downloads', 'chaves'];
const PERFIS: Perfil[] = ['corretor', 'admin'];

function FormularioUsuario({ inicial, proprio, editando, aoSalvar, aoCancelar }: {
  inicial: DadosUsuario;
  /** Editing yourself: the profile cannot change. */
  proprio: boolean;
  editando: boolean;
  aoSalvar: (d: DadosUsuario) => Promise<void>;
  aoCancelar: () => void;
}) {
  const { t } = useIdioma();
  const mensagemErro = useMensagemErro();
  const [f, setF] = useState(inicial);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const corretor = f.perfil === 'corretor';
  const alternar = <T extends string>(lista: T[], item: T) => (lista.includes(item) ? lista.filter((x) => x !== item) : [...lista, item]);
  // Removing API permissions from a corretor also removes them from their keys, for good.
  const removidas = editando && corretor && inicial.perfil === 'corretor'
    ? inicial.permissoesApi.filter((p) => !f.permissoesApi.includes(p))
    : [];

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      await aoSalvar({ ...f, nome: f.nome.trim(), email: f.email.trim() });
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
        <span>{t('usuarios.nome')}</span>
        <input required maxLength={100} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoFocus />
      </label>
      <label className="campo">
        <span>{t('usuarios.email')}</span>
        <input type="email" required maxLength={200} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </label>
      <label className="campo">
        <span>{t('usuarios.perfil')}</span>
        <select value={f.perfil} disabled={proprio} onChange={(e) => setF({ ...f, perfil: e.target.value as Perfil })}>
          {PERFIS.map((p) => <option key={p} value={p}>{t(`perfil.${p}`)}</option>)}
        </select>
        <small className="sutil">{t(proprio ? 'usuarios.perfilProprio' : `perfil.${f.perfil}.ajuda`)}</small>
      </label>
      {corretor && (
        <>
          <fieldset className="campo">
            <legend>{t('usuarios.telas')}</legend>
            {TELAS.map((tela) => (
              <label key={tela} className="opcao">
                <input type="checkbox" checked={f.telas.includes(tela)} onChange={() => setF({ ...f, telas: alternar(f.telas, tela) })} />
                <span>{t(`tela.${tela}`)}</span>
              </label>
            ))}
            <small className="sutil">{t('usuarios.telasAjuda')}</small>
          </fieldset>
          <fieldset className="campo">
            <legend>{t('usuarios.permissoesApi')}</legend>
            {TODAS_PERMISSOES.map((p: Permissao) => (
              <label key={p} className="opcao">
                <input type="checkbox" checked={f.permissoesApi.includes(p)} onChange={() => setF({ ...f, permissoesApi: alternar(f.permissoesApi, p) })} />
                <span>
                  {t(`chaves.permissao.${p}`)}
                  <small className="mono sutil">{t(`chaves.permissao.${p}.ajuda`)}</small>
                </span>
              </label>
            ))}
            <small className="sutil">{t('usuarios.permissoesApiAjuda')}</small>
          </fieldset>
          {removidas.length > 0 && <Alerta tom="info">{t('usuarios.removerPermissaoAviso')}</Alerta>}
        </>
      )}
      <div className="modal-rodape">
        <button type="button" className="botao" onClick={aoCancelar}>{t('comum.cancelar')}</button>
        <button type="submit" className="botao botao-primario" disabled={salvando || !f.nome.trim() || !f.email.trim()}>
          {salvando ? t('comum.salvando') : t(editando ? 'comum.salvar' : 'usuarios.criar')}
        </button>
      </div>
    </form>
  );
}

/** Screens and API permissions of a user, as chips. */
function Acessos({ u }: { u: UsuarioResumo }) {
  const { t } = useIdioma();
  if (u.perfil === 'admin') return <span className="sutil">{t('usuarios.acessoTotal')}</span>;
  if (!u.telas.length && !u.permissoesApi.length) return <span className="sutil">{t('usuarios.semAcesso')}</span>;
  return (
    <div className="chips">
      {TELAS.filter((tela) => u.telas.includes(tela)).map((tela) => <Selo key={tela} tom="neutro">{t(`tela.${tela}`)}</Selo>)}
      {u.permissoesApi.map((p) => <Selo key={p} tom="info">{t(`chaves.permissao.${p}`)}</Selo>)}
    </div>
  );
}

type Confirmacao = { tipo: 'desativar' | 'redefinir'; usuario: UsuarioResumo };

export function Usuarios({ aoAlterarProprio }: { aoAlterarProprio: () => void }) {
  const { t, locale } = useIdioma();
  const mensagemErro = useMensagemErro();
  const eu = useUsuarioAtual();
  const [usuarios, setUsuarios] = useState<UsuarioResumo[] | null>(null);
  const [erro, setErro] = useState('');
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<UsuarioResumo | null>(null);
  const [confirmando, setConfirmando] = useState<Confirmacao | null>(null);
  const [senhaTemporaria, setSenhaTemporaria] = useState<{ nome: string; senha: string } | null>(null);
  const [credencialDe, setCredencialDe] = useState<UsuarioResumo | null>(null);

  const carregar = useCallback(() => {
    api.usuarios().then((r) => setUsuarios(r.usuarios)).catch((e) => setErro(mensagemErro(e)));
    // Load on mount only (mensagemErro changes identity with the language).
  }, []);
  useEffect(carregar, [carregar]);

  const ativar = async (u: UsuarioResumo) => {
    setErro('');
    try {
      await api.definirAtivo(u.id, true);
      carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  };

  const confirmar = async () => {
    if (!confirmando) return;
    const { tipo, usuario } = confirmando;
    setConfirmando(null);
    setErro('');
    try {
      if (tipo === 'desativar') {
        await api.definirAtivo(usuario.id, false);
      } else {
        const r = await api.redefinirSenha(usuario.id);
        setSenhaTemporaria({ nome: usuario.nome, senha: r.senhaTemporaria });
      }
      carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  };

  return (
    <>
      <CabecalhoPagina
        titulo={t('usuarios.titulo')}
        descricao={t('usuarios.descricao')}
        acao={<button type="button" className="botao botao-primario" onClick={() => setCriando(true)}>{t('usuarios.novo')}</button>}
      />
      <Alerta>{erro}</Alerta>
      {!usuarios ? <Carregando /> : (
        <section className="cartao tabela-cartao">
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr>
                  <th>{t('usuarios.nome')}</th><th>{t('usuarios.perfil')}</th><th>{t('usuarios.acessos')}</th>
                  <th>{t('chaves.status')}</th><th>{t('usuarios.portal')}</th><th>{t('usuarios.ultimoLogin')}</th><th />
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => {
                  const proprio = u.id === eu.id;
                  return (
                    <tr key={u.id} className={u.ativo ? undefined : 'linha-inativa'}>
                      <td>
                        <strong>{u.nome}</strong>{proprio && <span className="sutil"> {t('usuarios.voce')}</span>}
                        <div className="sutil">{u.email}</div>
                      </td>
                      <td><Selo tom={u.perfil === 'admin' ? 'info' : 'neutro'}>{t(`perfil.${u.perfil}`)}</Selo></td>
                      <td><Acessos u={u} /></td>
                      <td>
                        <div className="chips">
                          {u.ativo ? <Selo tom="sucesso">{t('usuarios.ativo')}</Selo> : <Selo tom="neutro">{t('usuarios.desativado')}</Selo>}
                          {u.trocarSenha && <Selo tom="aviso">{t('usuarios.senhaTemporaria')}</Selo>}
                        </div>
                      </td>
                      <td><SeloCredencial credencial={u.credencialPortal} /></td>
                      <td className="nowrap">{u.ultimoLogin ? formatarDataHora(u.ultimoLogin, locale) : <span className="sutil">{t('chaves.nunca')}</span>}</td>
                      <td>
                        <div className="acoes acoes-quebra">
                          <Link para={`/chaves?usuarioId=${u.id}`} className="botao-link">{t('usuarios.verChaves')}</Link>
                          <button type="button" className="botao-link" onClick={() => setEditando(u)}>{t('chaves.editar')}</button>
                          <button type="button" className="botao-link" onClick={() => setCredencialDe(u)}>{t('usuarios.portal')}</button>
                          {!proprio && (
                            <>
                              <button type="button" className="botao-link" onClick={() => setConfirmando({ tipo: 'redefinir', usuario: u })}>{t('usuarios.redefinirSenha')}</button>
                              {u.ativo
                                ? <button type="button" className="botao-link perigo" onClick={() => setConfirmando({ tipo: 'desativar', usuario: u })}>{t('usuarios.desativar')}</button>
                                : <button type="button" className="botao-link" onClick={() => ativar(u)}>{t('usuarios.ativar')}</button>}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal titulo={t('usuarios.novoTitulo')} aberto={criando} aoFechar={() => setCriando(false)}>
        <FormularioUsuario
          inicial={{ nome: '', email: '', perfil: 'corretor', telas: [], permissoesApi: [] }}
          proprio={false}
          editando={false}
          aoCancelar={() => setCriando(false)}
          aoSalvar={async (d) => {
            const r = await api.criarUsuario(d);
            setCriando(false);
            setSenhaTemporaria({ nome: r.usuario.nome, senha: r.senhaTemporaria });
            carregar();
          }}
        />
      </Modal>

      <Modal titulo={t('usuarios.editarTitulo')} aberto={Boolean(editando)} aoFechar={() => setEditando(null)}>
        {editando && (
          <FormularioUsuario
            inicial={{
              nome: editando.nome, email: editando.email, perfil: editando.perfil,
              telas: editando.telas, permissoesApi: editando.permissoesApi,
            }}
            proprio={editando.id === eu.id}
            editando
            aoCancelar={() => setEditando(null)}
            aoSalvar={async (d) => {
              // Yourself: never send the profile (it cannot change; the select is disabled anyway).
              const proprio = editando.id === eu.id;
              const { perfil: _perfil, ...semPerfil } = d;
              await api.alterarUsuario(editando.id, proprio ? semPerfil : d);
              if (proprio) aoAlterarProprio(); // name/e-mail shown in the menu
              setEditando(null);
              carregar();
            }}
          />
        )}
      </Modal>

      <Modal
        titulo={t(confirmando?.tipo === 'redefinir' ? 'usuarios.redefinirTitulo' : 'usuarios.desativarTitulo')}
        aberto={Boolean(confirmando)}
        aoFechar={() => setConfirmando(null)}
        rodape={<>
          <button type="button" className="botao" onClick={() => setConfirmando(null)}>{t('comum.cancelar')}</button>
          <button type="button" className={confirmando?.tipo === 'desativar' ? 'botao botao-perigo' : 'botao botao-primario'} onClick={confirmar}>
            {t(confirmando?.tipo === 'redefinir' ? 'usuarios.redefinirConfirmar' : 'usuarios.desativarConfirmar')}
          </button>
        </>}
      >
        <p>{t(confirmando?.tipo === 'redefinir' ? 'usuarios.redefinirTexto' : 'usuarios.desativarTexto', { nome: confirmando?.usuario.nome ?? '' })}</p>
      </Modal>

      <Modal titulo={t('usuarios.credencialTitulo', { nome: credencialDe?.nome ?? '' })} aberto={Boolean(credencialDe)} aoFechar={() => setCredencialDe(null)}>
        {credencialDe && (
          <div className="formulario">
            {credencialDe.credencialPortal
              ? <DetalhesCredencial credencial={credencialDe.credencialPortal} />
              : <p className="sutil">{t('credenciais.nenhuma')}</p>}
            <FormularioCredencial
              emailInicial={credencialDe.credencialPortal?.emailPortal ?? ''}
              aoCancelar={() => setCredencialDe(null)}
              aoSalvar={async (c) => {
                await api.salvarCredencialDe(credencialDe.id, c);
                if (credencialDe.id === eu.id) aoAlterarProprio();
                setCredencialDe(null);
                carregar();
              }}
            />
          </div>
        )}
      </Modal>

      <Modal
        titulo={t('usuarios.senhaTitulo')}
        aberto={Boolean(senhaTemporaria)}
        aoFechar={() => setSenhaTemporaria(null)}
        rodape={<button type="button" className="botao botao-primario" onClick={() => setSenhaTemporaria(null)}>{t('usuarios.senhaOk')}</button>}
      >
        <Alerta tom="info">{t('usuarios.senhaTexto', { nome: senhaTemporaria?.nome ?? '' })}</Alerta>
        <div className="segredo">
          <code>{senhaTemporaria?.senha}</code>
          {senhaTemporaria && <BotaoCopiar texto={senhaTemporaria.senha} />}
        </div>
      </Modal>
    </>
  );
}
