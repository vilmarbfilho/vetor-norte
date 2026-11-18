import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type ChaveApiResumo, type Permissao } from '../api';
import { Alerta, BotaoCopiar, CabecalhoPagina, Carregando, Modal, Selo, useMensagemErro } from '../components/ui';
import { formatarDataHora } from '../format';
import { useIdioma } from '../i18n';
import { Link } from '../router';

interface FormChave { nome: string; permissoes: Permissao[]; limite: string }

function FormularioChave({ inicial, permissoes, aoSalvar, aoCancelar, textoSalvar }: {
  inicial: FormChave; permissoes: Permissao[]; textoSalvar: string;
  aoSalvar: (f: { nome: string; permissoes: Permissao[]; limitePorMinuto: number | null }) => Promise<void>;
  aoCancelar: () => void;
}) {
  const { t } = useIdioma();
  const mensagemErro = useMensagemErro();
  const [f, setF] = useState(inicial);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const alternar = (p: Permissao) =>
    setF({ ...f, permissoes: f.permissoes.includes(p) ? f.permissoes.filter((x) => x !== p) : [...f.permissoes, p] });

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      await aoSalvar({ nome: f.nome.trim(), permissoes: f.permissoes, limitePorMinuto: f.limite ? Number(f.limite) : null });
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
        <span>{t('chaves.nome')}</span>
        <input required maxLength={100} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoFocus />
      </label>
      <fieldset className="campo">
        <legend>{t('chaves.permissoes')}</legend>
        {permissoes.map((p) => (
          <label key={p} className="opcao">
            <input type="checkbox" checked={f.permissoes.includes(p)} onChange={() => alternar(p)} />
            <span>
              {t(`chaves.permissao.${p}`)}
              <small className="mono sutil">{t(`chaves.permissao.${p}.ajuda`)}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="campo">
        <span>{t('chaves.limite')}</span>
        <input type="number" min={1} max={10000} placeholder={t('chaves.limitePadrao')} value={f.limite} onChange={(e) => setF({ ...f, limite: e.target.value })} />
        <small className="sutil">{t('chaves.limiteAjuda')}</small>
      </label>
      <div className="modal-rodape">
        <button type="button" className="botao" onClick={aoCancelar}>{t('comum.cancelar')}</button>
        <button type="submit" className="botao botao-primario" disabled={salvando || f.permissoes.length === 0 || !f.nome.trim()}>
          {salvando ? t('comum.salvando') : textoSalvar}
        </button>
      </div>
    </form>
  );
}

export function Chaves() {
  const { t, locale } = useIdioma();
  const mensagemErro = useMensagemErro();
  const [chaves, setChaves] = useState<ChaveApiResumo[] | null>(null);
  const [permissoes, setPermissoes] = useState<Permissao[]>([]);
  const [erro, setErro] = useState('');
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<ChaveApiResumo | null>(null);
  const [revogando, setRevogando] = useState<ChaveApiResumo | null>(null);
  const [segredo, setSegredo] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api.chaves()
      .then((r) => {
        setChaves(r.chaves);
        setPermissoes(r.permissoesDisponiveis);
      })
      .catch((e) => setErro(mensagemErro(e)));
  }, [mensagemErro]);
  // Load once on mount (carregar changes identity with the language).
  useEffect(carregar, []);

  const revogar = async () => {
    if (!revogando) return;
    try {
      await api.revogarChave(revogando.id);
      setRevogando(null);
      carregar();
    } catch (e) {
      setErro(mensagemErro(e));
      setRevogando(null);
    }
  };

  return (
    <>
      <CabecalhoPagina
        titulo={t('chaves.titulo')}
        descricao={t('chaves.descricao')}
        acao={<button type="button" className="botao botao-primario" onClick={() => setCriando(true)}>{t('chaves.nova')}</button>}
      />
      <Alerta>{erro}</Alerta>
      {!chaves ? <Carregando /> : (
        <section className="cartao tabela-cartao">
          {chaves.length === 0 ? <p className="vazio">{t('comum.nenhum')}</p> : (
            <div className="tabela-rolagem">
              <table>
                <thead>
                  <tr>
                    <th>{t('chaves.nome')}</th><th>{t('chaves.permissoes')}</th><th className="num">{t('chaves.limite')}</th>
                    <th>{t('chaves.criada')}</th><th>{t('chaves.ultimoUso')}</th><th>{t('chaves.status')}</th><th />
                  </tr>
                </thead>
                <tbody>
                  {chaves.map((c) => (
                    <tr key={c.id} className={c.revogadaEm ? 'linha-inativa' : undefined}>
                      <td><strong>{c.nome}</strong><div className="mono sutil">{c.prefixo}…</div></td>
                      <td><div className="chips">{c.permissoes.map((p) => <Selo key={p} tom="info">{t(`chaves.permissao.${p}`)}</Selo>)}</div></td>
                      <td className="num">{c.limitePorMinuto ?? <span className="sutil">{t('chaves.limitePadrao')}</span>}</td>
                      <td className="nowrap">
                        {formatarDataHora(c.criadaEm, locale)}
                        {c.criadaPor && <div className="sutil">{t('chaves.por', { nome: c.criadaPor.nome })}</div>}
                      </td>
                      <td className="nowrap">{c.ultimoUsoEm ? formatarDataHora(c.ultimoUsoEm, locale) : <span className="sutil">{t('chaves.nunca')}</span>}</td>
                      <td>
                        {c.revogadaEm ? (
                          <span title={t('chaves.revogadaPor', { nome: c.revogadaPor?.nome ?? '—', data: formatarDataHora(c.revogadaEm, locale) })}>
                            <Selo tom="neutro">{t('chaves.revogada')}</Selo>
                          </span>
                        ) : <Selo tom="sucesso">{t('chaves.ativa')}</Selo>}
                      </td>
                      <td>
                        <div className="acoes">
                          <Link para={`/downloads?apiKeyId=${c.id}`} className="botao-link">{t('chaves.verDownloads')}</Link>
                          <Link para={`/logs?apiKeyId=${c.id}`} className="botao-link">{t('chaves.verLogs')}</Link>
                          {!c.revogadaEm && (
                            <>
                              <button type="button" className="botao-link" onClick={() => setEditando(c)}>{t('chaves.editar')}</button>
                              <button type="button" className="botao-link perigo" onClick={() => setRevogando(c)}>{t('chaves.revogar')}</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <Modal titulo={t('chaves.novaTitulo')} aberto={criando} aoFechar={() => setCriando(false)}>
        <FormularioChave
          inicial={{ nome: '', permissoes: [], limite: '' }}
          permissoes={permissoes}
          textoSalvar={t('chaves.criar')}
          aoCancelar={() => setCriando(false)}
          aoSalvar={async (f) => {
            const r = await api.criarChave(f);
            setCriando(false);
            setSegredo(r.segredo);
            carregar();
          }}
        />
      </Modal>

      <Modal titulo={t('chaves.editarTitulo')} aberto={Boolean(editando)} aoFechar={() => setEditando(null)}>
        {editando && (
          <FormularioChave
            inicial={{ nome: editando.nome, permissoes: editando.permissoes, limite: editando.limitePorMinuto?.toString() ?? '' }}
            permissoes={permissoes}
            textoSalvar={t('comum.salvar')}
            aoCancelar={() => setEditando(null)}
            aoSalvar={async (f) => {
              await api.alterarChave(editando.id, f);
              setEditando(null);
              carregar();
            }}
          />
        )}
      </Modal>

      <Modal
        titulo={t('chaves.revogarTitulo')}
        aberto={Boolean(revogando)}
        aoFechar={() => setRevogando(null)}
        rodape={<>
          <button type="button" className="botao" onClick={() => setRevogando(null)}>{t('comum.cancelar')}</button>
          <button type="button" className="botao botao-perigo" onClick={revogar}>{t('chaves.revogarConfirmar')}</button>
        </>}
      >
        <p>{t('chaves.revogarTexto', { nome: revogando?.nome ?? '' })}</p>
      </Modal>

      {/* The secret is kept only in memory and dropped when the modal closes. */}
      <Modal
        titulo={t('chaves.segredoTitulo')}
        aberto={Boolean(segredo)}
        aoFechar={() => setSegredo(null)}
        rodape={<button type="button" className="botao botao-primario" onClick={() => setSegredo(null)}>{t('chaves.segredoOk')}</button>}
      >
        <Alerta tom="info">{t('chaves.segredoTexto')}</Alerta>
        <div className="segredo">
          <code>{segredo}</code>
          {segredo && <BotaoCopiar texto={segredo} />}
        </div>
        <p className="sutil">{t('chaves.segredoUso')}</p>
      </Modal>
    </>
  );
}
