import { useCallback, useState, type FormEvent } from 'react';
import { api, type LogErro, type LogErroDetalhado } from '../api';
import { Alerta, CabecalhoPagina, Carregando, Modal, Paginacao, Selo, useMensagemErro } from '../components/ui';
import { formatarDataHora, primeiraLinha } from '../format';
import { useIdioma } from '../i18n';
import { FiltroChave } from './filters';
import { useListagem, valoresIniciais } from './useListagem';

const CAMPOS = ['de', 'ate', 'origem', 'status', 'busca', 'apiKeyId'];

function rotaDoLog(l: LogErro): string {
  return l.metodo || l.rota ? `${l.metodo ?? ''} ${l.rota ?? ''}`.trim() : '—';
}

export function Logs() {
  const { t, locale } = useIdioma();
  const mensagemErro = useMensagemErro();
  const buscar = useCallback((q: URLSearchParams) => api.logs(q), []);
  const { dados, erro, carregando, filtros, filtrar, irParaPagina } = useListagem(buscar);
  const [form, setForm] = useState(() => valoresIniciais(filtros, CAMPOS));
  const [detalhe, setDetalhe] = useState<LogErroDetalhado | null>(null);
  const [erroDetalhe, setErroDetalhe] = useState('');

  const aplicar = (e: FormEvent) => {
    e.preventDefault();
    filtrar(form);
  };
  const limpar = () => {
    const vazio = Object.fromEntries(CAMPOS.map((c) => [c, ''])) as Record<string, string>;
    setForm(vazio);
    filtrar({});
  };
  const abrir = async (id: string) => {
    setErroDetalhe('');
    try {
      setDetalhe(await api.log(id));
    } catch (e) {
      setErroDetalhe(mensagemErro(e));
    }
  };
  const campo = (nome: string) => ({ value: form[nome] ?? '', onChange: (e: { target: { value: string } }) => setForm({ ...form, [nome]: e.target.value }) });

  return (
    <>
      <CabecalhoPagina titulo={t('logs.titulo')} descricao={t('logs.descricao')} />
      <FiltroChave apiKeyId={filtros.get('apiKeyId')} aoRemover={() => { setForm({ ...form, apiKeyId: '' }); filtrar({ ...form, apiKeyId: '' }); }} />
      <form className="filtros" onSubmit={aplicar}>
        <label className="campo"><span>{t('comum.de')}</span><input type="date" {...campo('de')} /></label>
        <label className="campo"><span>{t('comum.ate')}</span><input type="date" {...campo('ate')} /></label>
        <label className="campo">
          <span>{t('logs.origem')}</span>
          <select {...campo('origem')}>
            <option value="">{t('comum.todos')}</option>
            <option value="api">{t('logs.origem.api')}</option>
            <option value="dashboard">{t('logs.origem.dashboard')}</option>
          </select>
        </label>
        <label className="campo campo-curto"><span>{t('logs.status')}</span><input type="number" min={100} max={599} {...campo('status')} /></label>
        <label className="campo campo-largo"><span>{t('logs.busca')}</span><input type="search" maxLength={100} {...campo('busca')} /></label>
        <div className="filtros-acoes">
          <button type="submit" className="botao botao-primario">{t('comum.filtrar')}</button>
          <button type="button" className="botao" onClick={limpar}>{t('comum.limpar')}</button>
        </div>
      </form>

      <Alerta>{erro ? mensagemErro(erro) : erroDetalhe}</Alerta>
      {carregando && !dados ? <Carregando /> : dados && (
        <section className="cartao tabela-cartao">
          {dados.itens.length === 0 ? <p className="vazio">{t('comum.nenhum')}</p> : (
            <div className="tabela-rolagem">
              <table>
                <thead>
                  <tr>
                    <th>{t('comum.quando')}</th><th>{t('logs.origem')}</th><th>{t('logs.status')}</th>
                    <th>{t('logs.rota')}</th><th>{t('logs.mensagem')}</th><th>{t('comum.chave')}</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.map((l) => (
                    <tr key={l.id} className="linha-clicavel" onClick={() => abrir(l.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && abrir(l.id)}>
                      <td className="nowrap">{formatarDataHora(l.ocorridoEm, locale)}</td>
                      <td><Selo tom="neutro">{t(l.origem === 'api' ? 'logs.origem.api' : 'logs.origem.dashboard')}</Selo></td>
                      <td>{l.statusHttp ? <Selo tom="erro">{l.statusHttp}</Selo> : '—'}</td>
                      <td className="mono">{rotaDoLog(l)}</td>
                      <td className="mensagem">{primeiraLinha(l.mensagem)}</td>
                      <td>{l.apiKey ? <span title={l.apiKey.prefixo}>{l.apiKey.nome}</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Paginacao pagina={dados.pagina} porPagina={dados.porPagina} total={dados.total} aoMudar={irParaPagina} />
        </section>
      )}

      <Modal titulo={t('comum.detalhes')} aberto={Boolean(detalhe)} aoFechar={() => setDetalhe(null)}>
        {detalhe && (
          <dl className="detalhes">
            <dt>{t('comum.quando')}</dt><dd>{formatarDataHora(detalhe.ocorridoEm, locale)}</dd>
            <dt>{t('logs.origem')}</dt>
            <dd>{detalhe.detalhes?.origem === 'keepalive' ? t('logs.keepalive') : t(detalhe.origem === 'api' ? 'logs.origem.api' : 'logs.origem.dashboard')}</dd>
            <dt>{t('logs.status')}</dt><dd>{detalhe.statusHttp ?? '—'}</dd>
            <dt>{t('logs.rota')}</dt><dd className="mono">{rotaDoLog(detalhe)}</dd>
            <dt>{t('comum.chave')}</dt><dd>{detalhe.apiKey ? `${detalhe.apiKey.nome} (${detalhe.apiKey.prefixo}…)` : '—'}</dd>
            <dt>{t('logs.requestId')}</dt><dd className="mono">{detalhe.requestId ?? '—'}</dd>
            <dt>{t('logs.mensagem')}</dt><dd><pre>{detalhe.mensagem}</pre></dd>
            {detalhe.detalhes && (<><dt>{t('comum.detalhes')}</dt><dd><pre>{JSON.stringify(detalhe.detalhes, null, 2)}</pre></dd></>)}
          </dl>
        )}
      </Modal>
    </>
  );
}
