import { useCallback, useState, type FormEvent } from 'react';
import { api, type Consulta } from '../api';
import { Alerta, CabecalhoPagina, Carregando, Paginacao, Selo, useMensagemErro } from '../components/ui';
import { formatarDataHora, formatarDuracao } from '../format';
import { useIdioma } from '../i18n';
import { Link } from '../router';
import { FiltroChave } from './filters';
import { useListagem, valoresIniciais } from './useListagem';

// Filters kept in the URL. The CPF is NOT: it stays in this page's memory only, so the full CPF never
// lands in the browser history or address bar (LGPD). Reloading the page drops the CPF filter.
const CAMPOS = ['de', 'ate', 'protocolo', 'resultado', 'apiKeyId'];
/** How many returned protocol numbers are listed per row before "+N". */
const MAX_PROTOCOLOS = 5;

export function Consultas() {
  const { t, locale } = useIdioma();
  const mensagemErro = useMensagemErro();
  const [cpf, setCpf] = useState('');
  const [cpfAplicado, setCpfAplicado] = useState('');
  const buscar = useCallback(
    (q: URLSearchParams) => {
      if (cpfAplicado) q.set('cpf', cpfAplicado);
      return api.consultas(q);
    },
    [cpfAplicado],
  );
  const { dados, erro, carregando, filtros, filtrar, irParaPagina } = useListagem(buscar);
  const [form, setForm] = useState(() => valoresIniciais(filtros, CAMPOS));

  const aplicar = (e: FormEvent) => {
    e.preventDefault();
    setCpfAplicado(cpf.trim());
    filtrar(form);
  };
  const limpar = () => {
    setForm(Object.fromEntries(CAMPOS.map((c) => [c, ''])));
    setCpf('');
    setCpfAplicado('');
    filtrar({});
  };
  const campo = (nome: string) => ({ value: form[nome] ?? '', onChange: (e: { target: { value: string } }) => setForm({ ...form, [nome]: e.target.value }) });

  return (
    <>
      <CabecalhoPagina titulo={t('consultas.titulo')} descricao={t('consultas.descricao')} />
      <FiltroChave apiKeyId={filtros.get('apiKeyId')} aoRemover={() => { setForm({ ...form, apiKeyId: '' }); filtrar({ ...form, apiKeyId: '' }); }} />
      <form className="filtros" onSubmit={aplicar}>
        <label className="campo"><span>{t('comum.de')}</span><input type="date" {...campo('de')} /></label>
        <label className="campo"><span>{t('comum.ate')}</span><input type="date" {...campo('ate')} /></label>
        <label className="campo">
          <span>{t('consultas.cpf')}</span>
          <input
            inputMode="numeric" autoComplete="off" maxLength={14} placeholder="000.000.000-00"
            pattern="\d{3}\.?\d{3}\.?\d{3}-?\d{2}" title={t('consultas.cpfAjuda')}
            value={cpf} onChange={(e) => setCpf(e.target.value)}
          />
        </label>
        <label className="campo"><span>{t('downloads.protocolo')}</span><input inputMode="numeric" pattern="\d*" maxLength={20} {...campo('protocolo')} /></label>
        <label className="campo">
          <span>{t('downloads.resultado')}</span>
          <select {...campo('resultado')}>
            <option value="">{t('comum.todos')}</option>
            <option value="ok">{t('downloads.resultado.ok')}</option>
            <option value="erro">{t('downloads.resultado.erro')}</option>
          </select>
        </label>
        <div className="filtros-acoes">
          <button type="submit" className="botao botao-primario">{t('comum.filtrar')}</button>
          <button type="button" className="botao" onClick={limpar}>{t('comum.limpar')}</button>
        </div>
      </form>

      <Alerta>{erro ? mensagemErro(erro) : ''}</Alerta>
      {carregando && !dados ? <Carregando /> : dados && (
        <section className="cartao tabela-cartao">
          {dados.itens.length === 0 ? <p className="vazio">{t('comum.nenhum')}</p> : (
            <div className="tabela-rolagem">
              <table>
                <thead>
                  <tr>
                    <th>{t('comum.quando')}</th><th>{t('consultas.cpf')}</th><th>{t('consultas.protocolos')}</th>
                    <th>{t('consultas.filtros')}</th><th>{t('downloads.resultado')}</th>
                    <th className="num">{t('downloads.duracao')}</th><th>{t('comum.chave')}</th><th>{t('downloads.criadaPor')}</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.map((c) => (
                    <tr key={c.id}>
                      <td className="nowrap">{formatarDataHora(c.ocorridoEm, locale)}</td>
                      <td className="mono nowrap">{c.cpfMascarado}</td>
                      <td><Protocolos consulta={c} /></td>
                      <td>{c.filtros ? <span className="mono sutil">{Object.entries(c.filtros).map(([k, v]) => `${k}=${v}`).join(', ')}</span> : '—'}</td>
                      <td><Selo tom={c.resultado === 'ok' ? 'sucesso' : 'erro'}>{t(`downloads.resultado.${c.resultado}`)}</Selo></td>
                      <td className="num">{formatarDuracao(c.duracaoMs, locale)}</td>
                      <td>{c.apiKey ? <>{c.apiKey.nome} <span className="sutil mono">{c.apiKey.prefixo}…</span></> : <span className="sutil">{t('comum.chaveRemovida')}</span>}</td>
                      <td>{c.apiKey?.criadaPor?.nome ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Paginacao pagina={dados.pagina} porPagina={dados.porPagina} total={dados.total} aoMudar={irParaPagina} />
        </section>
      )}
    </>
  );
}

/** Count + the first protocol numbers, each linking to its PDF downloads. */
function Protocolos({ consulta }: { consulta: Consulta }) {
  const { t } = useIdioma();
  if (consulta.quantidade === null) return <>—</>;
  if (consulta.quantidade === 0) return <span className="sutil">{t('consultas.nenhumProtocolo')}</span>;
  const extras = consulta.protocolos.length - MAX_PROTOCOLOS;
  return (
    <div className="lista-protocolos">
      {consulta.protocolos.slice(0, MAX_PROTOCOLOS).map((p) => (
        <Link key={p} para={`/downloads?protocolo=${p}`} className="botao-link mono">{p}</Link>
      ))}
      {extras > 0 && <span className="sutil" title={consulta.protocolos.join(', ')}>{t('consultas.maisProtocolos', { n: extras })}</span>}
    </div>
  );
}
