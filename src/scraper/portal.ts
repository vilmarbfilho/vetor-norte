// Portal automation steps, each isolated in its own function.
// Selectors avoid the dynamic ids recorded by codegen (iframe name, row id).

import type { BrowserContext, Page } from 'playwright';
import { formatarDocumento, somenteDigitos } from '../utils/cpf.ts';

const log = (msg: string) => console.log(`[portal] ${msg}`);

/** Selector for each protocol's "⋮" menu button (the suffix is the protocol's internal id). */
const MENU_LINHA = '[id^="demo-menu-lower-right_"]';
/** Max pages per search (guards against an endless loop if the site changes). */
const MAX_PAGINAS = 50;

/**
 * Filters accepted by the Protocolo screen. Each one becomes a search URL parameter
 * (the Broker search is a GET form: buscaProtocolosNovo.php?txtCpfSegurado=...).
 */
export interface FiltrosBusca {
  /** Insured person's CPF or CNPJ (masked or digits only). */
  documento?: string;
  /** Protocol number ([NP]). */
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

/** Default form values, identical to what the screen sends when clicking Buscar. */
const PARAMETROS_PADRAO =
  'busca=ok&txtProdutor=&txtCompanhia=0&txtRamo=&txtNomeSegurado=&txtTelefone=&txtCpfSegurado=' +
  '&txtNrProtocolo=&txtNrProposta=&txtNrApolice=&txtNrEndosso=&txtDtVigenciaInicio=&txtDtVigenciaFim=' +
  '&txtDtCadastroInicio=&txtDtCadastroFim=&txtStatusProtocolo=&txtStatusProposta=&txtNrSinistroBroker=' +
  '&txtNrSinistroSeguradora=&txtPossuiSinistro=&txtNrPlaca=&txtNrChassi=&txtCep=' +
  '&txtValorOrdem=lojacobr.protocolo.data&txtOrdem=desc';

export interface Protocolo {
  /** Broker internal id (used in URLs: /protocolo/visualizar/<idInterno>). */
  idInterno: string;
  /** Protocol number ([NP]). */
  protocolo: string;
  /** Protocol type ([TP]), e.g. "Principal". */
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
  /** Broker URL of the "PDF da Proposta" (null when the protocol has no PDF). */
  pdfUrl: string | null;
}

/**
 * Must be called right after creating the context, before opening pages.
 * tsx/esbuild wraps named functions in `__name(fn, "name")`. That helper exists in
 * Node but not in the browser, which breaks page.evaluate callbacks.
 * We define a harmless __name on every page of the context.
 */
export async function prepararContexto(context: BrowserContext): Promise<void> {
  await context.addInitScript('globalThis.__name = globalThis.__name || ((fn) => fn);');
}

/** Step A: log in to the access portal. */
export async function login(page: Page, url: string, email: string, senha: string): Promise<void> {
  log('Abrindo página de login');
  await page.goto(url);
  await page.getByRole('textbox', { name: 'E-mail' }).fill(email);
  await page.getByRole('textbox', { name: 'Senha' }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Login succeeded = the Broker button shows up.
  await page.getByRole('button', { name: /^Broker/ }).waitFor({ timeout: 20_000 });
  log('Login OK');
}

/** Step B: open the Broker system (it opens in a new tab/popup). */
export async function abrirBroker(page: Page): Promise<Page> {
  log('Abrindo Broker');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /^Broker/ }).click();
  const broker = await popupPromise;
  await registrarFechamentoDeOverlays(broker);
  // The tab goes through redirects (integrador -> menu.php). It is only ready once
  // the dashboard shows up; navigating earlier aborts (net::ERR_ABORTED).
  await broker.getByRole('link', { name: /^\W*Protocolo$/ }).waitFor({ timeout: 60_000 });
  log('Painel do Broker carregado');
  return broker;
}

/**
 * The Broker opens modals at unpredictable times (colorbox with notices/campaigns,
 * announcekit widget). With addLocatorHandler, before EVERY action Playwright checks
 * whether one of them is in the way and closes it, no matter when it appears.
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
    // Last resort: if it is still open, remove it from the DOM.
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
 * Step C: search protocols by navigating straight to the search URL (instead of filling
 * the form, whose CPF field is cleared by the page itself while it loads).
 * Walks through every result page.
 */
export async function buscarProtocolos(broker: Page, filtros: FiltrosBusca): Promise<Protocolo[]> {
  const params = new URLSearchParams(PARAMETROS_PADRAO);
  for (const [campo, valor] of Object.entries(filtros) as [keyof FiltrosBusca, string | undefined][]) {
    if (!valor) continue;
    // The portal only finds the document when it is masked (529.982.247-25).
    params.set(PARAMETRO_DO_FILTRO[campo], campo === 'documento' ? formatarDocumento(valor) : valor.trim());
  }
  const urlBusca = new URL('/broker/buscaProtocolosNovo.php', broker.url());

  const protocolos: Protocolo[] = [];
  let total = 0;
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    params.set('page', String(pagina));
    urlBusca.search = params.toString();
    await broker.goto(urlBusca.toString(), { waitUntil: 'domcontentloaded' });

    // Summary text: "8 resultados encontrados" / "0 resultados encontrados"
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

  // Privacy guard: with a document filter, no row may belong to another insured person.
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
 * Reads the results table. Actual Broker structure:
 *  - each protocol = 1 main row (with the menu button) + detail rows
 *    (colspan=9) with Proposta/Apólice, sales hierarchy and items;
 *  - main columns are located by header TEXT, not by position.
 */
export async function extrairTabela(broker: Page): Promise<Protocolo[]> {
  return broker.evaluate((seletorMenu) => {
    const limpar = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const normalizar = (s: string) =>
      limpar(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    // Cell text keeping <br> line breaks (one line per item).
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

      // Protocolo: "[NP] 12345678 [TP] Principal"
      const txtProtocolo = limpar(celula('protocolo')?.textContent);
      const protocolo = /\[NP\]\s*(\S+)/.exec(txtProtocolo)?.[1] ?? txtProtocolo;
      const tipo = /\[TP\]\s*(.+?)(?=\s*\[|$)/.exec(txtProtocolo)?.[1] ?? '';

      // Segurado: "NAME<br>(529.982.247-25)"
      const txtSegurado = limpar(celula('segurado')?.textContent);
      const seguradoDocumento = /\(([\d./-]+)\)/.exec(txtSegurado)?.[1] ?? '';
      const seguradoNome = limpar(txtSegurado.replace(/\([\d./-]+\)/, ''));

      // Seguradora: <img alt="Tokio Marine Seguradora"> + "Ramo<br>Produto"
      const celSeguradora = celula('seguradora');
      const [ramo = '', produto = ''] = linhasDe(celSeguradora);
      const seguradora = celSeguradora?.querySelector('img')?.getAttribute('alt') ?? '';

      // Status proposta / sinistro share the same column.
      const [statusProposta = '', ...sinistro] = linhasDe(celula('statusPropostaSinistro'));

      // Detail rows up to the next protocol: Proposta / Apólice.
      let detalhe = '';
      for (let tr = linha.nextElementSibling; tr && !tr.querySelector(seletorMenu); tr = tr.nextElementSibling) {
        detalhe += ' ' + limpar(tr.textContent);
      }
      const proposta = /Proposta:\s*(\S+)/.exec(detalhe)?.[1] ?? '';
      const apolice = limpar(/Apolice:\s*(.+?)(?=\s+Regional|\s+Item:|$)/.exec(detalhe)?.[1]);

      // PDF URL: lives in the onclick of the "PDF da Proposta" item of this row's menu.
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
 * Step D: download the "PDF da Proposta" from the URL extracted from the table.
 * context.request reuses the logged-in session cookies and follows the redirect to the
 * pre-signed S3 URL. No menu clicks or new tabs needed.
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

/** Diagnostics: HTML of the results table (development only). */
export async function htmlDosResultados(broker: Page): Promise<string> {
  const tabela = broker.locator('table').filter({ has: broker.locator(MENU_LINHA) }).first();
  if (await tabela.count()) return tabela.evaluate((el) => el.outerHTML);
  return broker.content();
}
