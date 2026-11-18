// Passos da automação no portal, cada um isolado em uma função.
// Os seletores evitam IDs dinâmicos que o codegen gravou (iframe name, id da linha).

import type { BrowserContext, Page } from 'playwright';
import { formatarDocumento, somenteDigitos } from '../utils/cpf.ts';

const log = (msg: string) => console.log(`[portal] ${msg}`);

/** Seletor do botão "⋮" de cada protocolo (o sufixo é o id interno do protocolo). */
const MENU_LINHA = '[id^="demo-menu-lower-right_"]';
/** Limite de páginas por busca (proteção contra loop se o site mudar). */
const MAX_PAGINAS = 50;

/**
 * Filtros aceitos pela tela de Protocolo. Cada um vira um parâmetro da URL de busca
 * (a busca do Broker é um formulário GET: buscaProtocolosNovo.php?txtCpfSegurado=...).
 */
export interface FiltrosBusca {
  /** CPF ou CNPJ do segurado (com ou sem máscara). */
  documento?: string;
  /** Número do protocolo ([NP]). */
  protocolo?: string;
  proposta?: string;
  apolice?: string;
  nomeSegurado?: string;
}

const PARAMETRO_DO_FILTRO: Record<keyof FiltrosBusca, string> = {
  documento: 'txtCpfSegurado',
  protocolo: 'txtNrProtocolo',
  proposta: 'txtNrProposta',
  apolice: 'txtNrApolice',
  nomeSegurado: 'txtNomeSegurado',
};

/** Valores padrão do formulário, iguais aos que a tela envia ao clicar em Buscar. */
const PARAMETROS_PADRAO =
  'busca=ok&txtProdutor=&txtCompanhia=0&txtRamo=&txtNomeSegurado=&txtTelefone=&txtCpfSegurado=' +
  '&txtNrProtocolo=&txtNrProposta=&txtNrApolice=&txtNrEndosso=&txtDtVigenciaInicio=&txtDtVigenciaFim=' +
  '&txtDtCadastroInicio=&txtDtCadastroFim=&txtStatusProtocolo=&txtStatusProposta=&txtNrSinistroBroker=' +
  '&txtNrSinistroSeguradora=&txtPossuiSinistro=&txtNrPlaca=&txtNrChassi=&txtCep=' +
  '&txtValorOrdem=lojacobr.protocolo.data&txtOrdem=desc';

export interface Protocolo {
  /** Id interno do Broker (usado nas URLs: /protocolo/visualizar/<idInterno>). */
  idInterno: string;
  /** Número do protocolo ([NP]). */
  protocolo: string;
  /** Tipo do protocolo ([TP]), ex: "Principal". */
  tipo: string;
  dataProtocolo: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  seguradoNome: string;
  seguradoDocumento: string;
  seguradora: string;
  ramo: string;
  produto: string;
  statusProtocolo: string;
  statusProposta: string;
  statusSinistro: string;
  proposta: string;
  apolice: string;
  /** URL do "PDF da Proposta" no Broker (null se o protocolo não tiver PDF). */
  pdfUrl: string | null;
}

/**
 * Deve ser chamado logo após criar o contexto, antes de abrir páginas.
 * O tsx/esbuild envolve funções nomeadas em `__name(fn, "nome")`. Esse helper existe
 * no Node, mas não no navegador, e quebra os callbacks de page.evaluate.
 * Definimos um __name inofensivo em toda página do contexto.
 */
export async function prepararContexto(context: BrowserContext): Promise<void> {
  await context.addInitScript('globalThis.__name = globalThis.__name || ((fn) => fn);');
}

/** Etapa A: faz login no portal de acesso. */
export async function login(page: Page, url: string, email: string, senha: string): Promise<void> {
  log('Abrindo página de login');
  await page.goto(url);
  await page.getByRole('textbox', { name: 'E-mail' }).fill(email);
  await page.getByRole('textbox', { name: 'Senha' }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Login ok = o botão do Broker aparece.
  await page.getByRole('button', { name: /^Broker/ }).waitFor({ timeout: 20_000 });
  log('Login OK');
}

/** Etapa B: abre o sistema Broker (ele abre em uma nova aba/popup). */
export async function abrirBroker(page: Page): Promise<Page> {
  log('Abrindo Broker');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /^Broker/ }).click();
  const broker = await popupPromise;
  await registrarFechamentoDeOverlays(broker);
  // A aba passa por redirecionamentos (integrador -> menu.php). Só está pronta
  // quando o painel aparece; navegar antes disso aborta (net::ERR_ABORTED).
  await broker.getByRole('link', { name: /^\W*Protocolo$/ }).waitFor({ timeout: 60_000 });
  log('Painel do Broker carregado');
  return broker;
}

/**
 * O Broker abre modais em momentos imprevisíveis (colorbox de avisos/campanhas,
 * widget do announcekit). Com addLocatorHandler, antes de CADA ação o Playwright
 * verifica se algum deles está na frente e o fecha. Não importa quando ele aparece.
 */
async function registrarFechamentoDeOverlays(page: Page): Promise<void> {
  const colorbox = page.locator('#colorbox');
  await page.addLocatorHandler(colorbox, async () => {
    const fecharNoIframe = colorbox.frameLocator('iframe').getByRole('button', { name: 'Fechar' });
    const temFechar = await fecharNoIframe
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (temFechar) {
      await fecharNoIframe.click();
    } else if (await page.locator('#cboxClose').isVisible()) {
      await page.locator('#cboxClose').click();
    } else {
      await page.keyboard.press('Escape');
    }
    // Último recurso: se continuou aberto, remove do DOM.
    await page.waitForTimeout(500);
    if (await colorbox.isVisible()) {
      await page.evaluate(() =>
        document.querySelectorAll('#colorbox, #cboxOverlay').forEach((el) => el.remove()),
      );
    }
    log('Modal (colorbox) fechado');
  });

  const announcekit = page.locator('.announcekit-widget-iframe-backdrop');
  await page.addLocatorHandler(announcekit, async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (await announcekit.isVisible()) {
      await page.evaluate(() =>
        document
          .querySelectorAll('[class*="announcekit-widget"]')
          .forEach((el) => el.remove()),
      );
    }
    log('Widget de novidades (announcekit) fechado');
  });
}

/**
 * Etapa C: busca protocolos navegando direto para a URL de busca (sem preencher o
 * formulário, cujo campo de CPF é limpo pela própria página durante o carregamento).
 * Percorre todas as páginas de resultado.
 */
export async function buscarProtocolos(broker: Page, filtros: FiltrosBusca): Promise<Protocolo[]> {
  const params = new URLSearchParams(PARAMETROS_PADRAO);
  for (const [campo, valor] of Object.entries(filtros) as [keyof FiltrosBusca, string | undefined][]) {
    if (!valor) continue;
    // O portal só encontra o documento no formato com máscara (014.628.966-85).
    params.set(PARAMETRO_DO_FILTRO[campo], campo === 'documento' ? formatarDocumento(valor) : valor.trim());
  }
  const urlBusca = new URL('/broker/buscaProtocolosNovo.php', broker.url());

  const protocolos: Protocolo[] = [];
  let total = 0;
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    params.set('page', String(pagina));
    urlBusca.search = params.toString();
    await broker.goto(urlBusca.toString(), { waitUntil: 'domcontentloaded' });

    // "8 resultados encontrados" / "0 resultados encontrados"
    const resumo = await broker
      .getByText(/\d+\s+resultados? encontrados?/i)
      .first()
      .textContent({ timeout: 30_000 });
    total = Number(/(\d+)/.exec(resumo ?? '')?.[1] ?? 0);
    if (total === 0) break;

    const daPagina = await extrairTabela(broker);
    protocolos.push(...daPagina);
    log(`Página ${pagina}: ${daPagina.length} protocolo(s) (${protocolos.length}/${total})`);
    if (daPagina.length === 0 || protocolos.length >= total) break;
  }

  // Garantia: com filtro de documento, nenhuma linha pode ser de outro segurado.
  if (filtros.documento) {
    const doc = somenteDigitos(filtros.documento);
    const outros = protocolos.filter((p) => somenteDigitos(p.seguradoDocumento) !== doc);
    if (outros.length) {
      throw new Error(`Busca retornou ${outros.length} protocolo(s) de outro segurado. Abortando por segurança.`);
    }
  }
  if (protocolos.length < total) {
    log(`Atenção: ${total} resultados informados, ${protocolos.length} lidos.`);
  }
  log(`Total: ${protocolos.length} protocolo(s)`);
  return protocolos;
}

/**
 * Lê a tabela de resultados. Estrutura real do Broker:
 *  - cada protocolo = 1 linha principal (com o botão de menu) + linhas de detalhe
 *    (colspan=9) com Proposta/Apólice, hierarquia e itens;
 *  - colunas principais localizadas pelo TEXTO do cabeçalho, não pela posição.
 */
export async function extrairTabela(broker: Page): Promise<Protocolo[]> {
  return broker.evaluate((seletorMenu) => {
    const limpar = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const normalizar = (s: string) =>
      limpar(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    // Texto da célula preservando as quebras de <br> (uma linha por item).
    const linhasDe = (el: Element | undefined) => {
      if (!el) return [] as string[];
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
      return (clone.textContent ?? '').split('\n').map(limpar).filter(Boolean);
    };

    const colunaDoCabecalho = (h: string): string | null => {
      if (h.includes('status') && h.includes('protocolo')) return 'statusProtocolo';
      if (h.includes('status') && h.includes('proposta')) return 'statusPropostaSinistro';
      if (h.includes('data') && h.includes('protocolo')) return 'dataProtocolo';
      if (h.includes('vigencia') && h.includes('inicio')) return 'vigenciaInicio';
      if (h.includes('vigencia') && h.includes('fim')) return 'vigenciaFim';
      if (h.includes('seguradora')) return 'seguradora';
      if (h.includes('segurado')) return 'segurado';
      if (h.includes('protocolo')) return 'protocolo';
      return null;
    };

    const menus = Array.from(document.querySelectorAll<HTMLElement>(seletorMenu));
    const tabela = menus[0]?.closest('table');
    if (!tabela) throw new Error('Tabela de resultados não encontrada.');

    const colunas = Array.from(tabela.querySelectorAll('thead th')).map((th) =>
      colunaDoCabecalho(normalizar(th.textContent ?? '')),
    );
    const indice = (nome: string) => colunas.indexOf(nome);

    return menus.map((menu) => {
      const linha = menu.closest('tr')!;
      const tds = Array.from(linha.children).filter((c) => c.tagName === 'TD');
      const celula = (nome: string) => tds[indice(nome)];

      // Protocolo: "[NP] 18754914 [TP] Principal"
      const txtProtocolo = limpar(celula('protocolo')?.textContent);
      const protocolo = /\[NP\]\s*(\S+)/.exec(txtProtocolo)?.[1] ?? txtProtocolo;
      const tipo = /\[TP\]\s*(.+?)(?=\s*\[|$)/.exec(txtProtocolo)?.[1] ?? '';

      // Segurado: "NOME<br>(701.528.968-72)"
      const txtSegurado = limpar(celula('segurado')?.textContent);
      const seguradoDocumento = /\(([\d./-]+)\)/.exec(txtSegurado)?.[1] ?? '';
      const seguradoNome = limpar(txtSegurado.replace(/\([\d./-]+\)/, ''));

      // Seguradora: <img alt="Tokio Marine Seguradora"> + "Ramo<br>Produto"
      const celSeguradora = celula('seguradora');
      const [ramo = '', produto = ''] = linhasDe(celSeguradora);
      const seguradora = celSeguradora?.querySelector('img')?.getAttribute('alt') ?? '';

      // Status proposta / sinistro dividem a mesma coluna.
      const [statusProposta = '', ...sinistro] = linhasDe(celula('statusPropostaSinistro'));

      // Linhas de detalhe até o próximo protocolo: Proposta / Apólice.
      let detalhe = '';
      for (let tr = linha.nextElementSibling; tr && !tr.querySelector(seletorMenu); tr = tr.nextElementSibling) {
        detalhe += ' ' + limpar(tr.textContent);
      }
      const proposta = /Proposta:\s*(\S+)/.exec(detalhe)?.[1] ?? '';
      const apolice = limpar(/Apolice:\s*(.+?)(?=\s+Regional|\s+Item:|$)/.exec(detalhe)?.[1]);

      // URL do PDF: está no onclick do item "PDF da Proposta" do menu desta linha.
      const itemPdf = Array.from(document.querySelectorAll(`ul[for="${menu.id}"] li`)).find((li) =>
        (li.textContent ?? '').includes('PDF da Proposta'),
      );
      const pdfUrl = /window\.open\('([^']+)'/.exec(itemPdf?.getAttribute('onclick') ?? '')?.[1] ?? null;

      return {
        idInterno: menu.id.split('_').pop() ?? '',
        protocolo,
        tipo,
        dataProtocolo: limpar(celula('dataProtocolo')?.textContent),
        vigenciaInicio: limpar(celula('vigenciaInicio')?.textContent),
        vigenciaFim: limpar(celula('vigenciaFim')?.textContent),
        seguradoNome,
        seguradoDocumento,
        seguradora,
        ramo,
        produto,
        statusProtocolo: limpar(celula('statusProtocolo')?.textContent),
        statusProposta,
        statusSinistro: sinistro.join(' / '),
        proposta,
        apolice,
        pdfUrl,
      };
    });
  }, MENU_LINHA);
}

/**
 * Etapa D: baixa o "PDF da Proposta" pela URL extraída da tabela.
 * context.request usa os mesmos cookies da sessão logada e segue o redirecionamento
 * para a URL pré-assinada do S3. Não precisa clicar no menu nem abrir aba.
 */
export async function baixarPdfProposta(
  context: BrowserContext,
  protocolo: Protocolo,
): Promise<Buffer> {
  if (!protocolo.pdfUrl) {
    throw new Error(`O protocolo ${protocolo.protocolo} não tem "PDF da Proposta".`);
  }
  log(`Baixando PDF do protocolo ${protocolo.protocolo}`);

  const resposta = await context.request.get(protocolo.pdfUrl);
  if (!resposta.ok()) throw new Error(`Falha ao baixar PDF: HTTP ${resposta.status()}`);
  const conteudo = await resposta.body();
  if (conteudo.subarray(0, 4).toString() !== '%PDF') {
    throw new Error('O arquivo baixado não é um PDF válido (sessão expirada?).');
  }
  return conteudo;
}

/** Diagnóstico: HTML da tabela de resultados (só para desenvolvimento). */
export async function htmlDosResultados(broker: Page): Promise<string> {
  const tabela = broker.locator('table').filter({ has: broker.locator(MENU_LINHA) }).first();
  if (await tabela.count()) return tabela.evaluate((el) => el.outerHTML);
  return broker.content();
}
