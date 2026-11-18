// Small fetch wrapper for the dashboard API: same-origin cookie, CSRF header, JSON, typed errors.
import type {
  ChaveApiResumo, Consulta, Download, Idioma, LogErro, LogErroDetalhado, Pagina, Usuario,
} from '../../server/repositories/types.ts';
import type { Permissao } from '../../server/auth/api-keys.ts';

export type { ChaveApiResumo, Consulta, Download, Idioma, LogErro, LogErroDetalhado, Pagina, Permissao, Usuario };

/** API error: `codigo` is translated by the UI (erro.<codigo>). */
export class ErroApi extends Error {
  constructor(public readonly status: number, public readonly codigo: string, public readonly dados: Record<string, unknown> = {}) {
    super(codigo);
  }
}

/** Fired when any call gets 401: the app goes back to the login screen. */
export const EVENTO_SESSAO_EXPIRADA = 'vn:sessao-expirada';

async function chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api${caminho}`, {
      method: metodo,
      credentials: 'same-origin',
      headers: {
        // Required by the server on state-changing requests (CSRF protection).
        'X-Requested-With': 'vetornorte-dashboard',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new ErroApi(0, 'rede');
  }
  if (resposta.status === 204) return undefined as T;
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    if (resposta.status === 401 && caminho !== '/auth/login') window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    throw new ErroApi(resposta.status, typeof dados.codigo === 'string' ? dados.codigo : 'generico', dados);
  }
  return dados as T;
}

export const api = {
  eu: () => chamar<{ usuario: Usuario }>('GET', '/auth/eu'),
  login: (email: string, senha: string) => chamar<{ usuario: Usuario }>('POST', '/auth/login', { email, senha }),
  logout: () => chamar<void>('POST', '/auth/logout'),
  definirIdioma: (idioma: Idioma) => chamar<{ usuario: Usuario }>('PATCH', '/auth/eu', { idioma }),
  alterarSenha: (senhaAtual: string, novaSenha: string) => chamar<void>('POST', '/auth/eu/senha', { senhaAtual, novaSenha }),
  logs: (q: URLSearchParams) => chamar<Pagina<LogErro>>('GET', `/logs?${q}`),
  log: (id: string) => chamar<LogErroDetalhado>('GET', `/logs/${encodeURIComponent(id)}`),
  consultas: (q: URLSearchParams) => chamar<Pagina<Consulta>>('GET', `/consultas?${q}`),
  downloads: (q: URLSearchParams) => chamar<Pagina<Download>>('GET', `/downloads?${q}`),
  chaves: () => chamar<{ chaves: ChaveApiResumo[]; permissoesDisponiveis: Permissao[] }>('GET', '/chaves'),
  criarChave: (c: { nome: string; permissoes: Permissao[]; limitePorMinuto: number | null }) =>
    chamar<{ chave: ChaveApiResumo; segredo: string }>('POST', '/chaves', c),
  alterarChave: (id: string, c: { nome?: string; permissoes?: Permissao[]; limitePorMinuto?: number | null }) =>
    chamar<{ chave: ChaveApiResumo }>('PATCH', `/chaves/${id}`, c),
  revogarChave: (id: string) => chamar<{ chave: ChaveApiResumo }>('POST', `/chaves/${id}/revogar`),
};
