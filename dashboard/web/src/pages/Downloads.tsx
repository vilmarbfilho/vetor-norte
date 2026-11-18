import { useCallback, useState, type FormEvent } from 'react';
import { api, type Download } from '../api';
import { Alerta, CabecalhoPagina, Carregando, Paginacao, Selo, useMensagemErro, type Tom } from '../components/ui';
import { formatarBytes, formatarDataHora, formatarDuracao } from '../format';
import { useIdioma } from '../i18n';
import { ehAdmin } from '../acesso';
import { useUsuarioAtual } from '../sessao';
import { CampoUsuario, FiltroChave } from './filters';
import { useListagem, valoresIniciais } from './useListagem';

const CAMPOS = ['de', 'ate', 'protocolo', 'tipo', 'resultado', 'apiKeyId', 'usuarioId'];
const TOM: Record<Download['resultado'], Tom> = { ok: 'sucesso', nao_encontrado: 'aviso', sem_pdf: 'aviso', erro: 'erro' };

export function Downloads() {
  const { t, locale } = useIdioma();
  const mensagemErro = useMensagemErro();
  // Corretores only see their own downloads: the user column/filter would always be them.
  const admin = ehAdmin(useUsuarioAtual());
  const buscar = useCallback((q: URLSearchParams) => api.downloads(q), []);
  const { dados, erro, carregando, filtros, filtrar, irParaPagina } = useListagem(buscar);
  const [form, setForm] = useState(() => valoresIniciais(filtros, CAMPOS));

  const aplicar = (e: FormEvent) => {
    e.preventDefault();
    filtrar(form);
  };
  const limpar = () => {
    setForm(Object.fromEntries(CAMPOS.map((c) => [c, ''])));
    filtrar({});
  };
  const campo = (nome: string) => ({ value: form[nome] ?? '', onChange: (e: { target: { value: string } }) => setForm({ ...form, [nome]: e.target.value }) });

  return (
    <>
      <CabecalhoPagina titulo={t('downloads.titulo')} descricao={t('downloads.descricao')} />
      <FiltroChave apiKeyId={filtros.get('apiKeyId')} aoRemover={() => { setForm({ ...form, apiKeyId: '' }); filtrar({ ...form, apiKeyId: '' }); }} />
      <form className="filtros" onSubmit={aplicar}>
        <label className="campo"><span>{t('comum.de')}</span><input type="date" {...campo('de')} /></label>
        <label className="campo"><span>{t('comum.ate')}</span><input type="date" {...campo('ate')} /></label>
        <label className="campo"><span>{t('downloads.protocolo')}</span><input inputMode="numeric" pattern="\d*" maxLength={20} {...campo('protocolo')} /></label>
        <label className="campo">
          <span>{t('downloads.tipo')}</span>
          <select {...campo('tipo')}>
            <option value="">{t('comum.todos')}</option>
            <option value="binario">{t('downloads.tipo.binario')}</option>
            <option value="base64">{t('downloads.tipo.base64')}</option>
            <option value="envio">{t('downloads.tipo.envio')}</option>
          </select>
        </label>
        <label className="campo">
          <span>{t('downloads.resultado')}</span>
          <select {...campo('resultado')}>
            <option value="">{t('comum.todos')}</option>
            {(['ok', 'nao_encontrado', 'sem_pdf', 'erro'] as const).map((r) => <option key={r} value={r}>{t(`downloads.resultado.${r}`)}</option>)}
          </select>
        </label>
        <CampoUsuario {...campo('usuarioId')} />
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
                    <th>{t('comum.quando')}</th><th>{t('downloads.protocolo')}</th><th>{t('downloads.tipo')}</th>
                    <th>{t('downloads.resultado')}</th><th className="num">{t('downloads.tamanho')}</th>
                    <th className="num">{t('downloads.duracao')}</th><th>{t('comum.chave')}</th>{admin && <th>{t('comum.usuario')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.map((d) => (
                    <tr key={d.id}>
                      <td className="nowrap">{formatarDataHora(d.ocorridoEm, locale)}</td>
                      <td className="mono">{d.protocolo}</td>
                      <td>{t(`downloads.tipo.${d.tipo}`)}{d.destino && <span className="sutil"> → {d.destino}</span>}</td>
                      <td><Selo tom={TOM[d.resultado]}>{t(`downloads.resultado.${d.resultado}`)}</Selo></td>
                      <td className="num">{formatarBytes(d.tamanhoBytes, locale)}</td>
                      <td className="num">{formatarDuracao(d.duracaoMs, locale)}</td>
                      <td>{d.apiKey ? <>{d.apiKey.nome} <span className="sutil mono">{d.apiKey.prefixo}…</span></> : <span className="sutil">{t('comum.chaveRemovida')}</span>}</td>
                      {admin && <td>{d.usuario?.nome ?? '—'}</td>}
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
