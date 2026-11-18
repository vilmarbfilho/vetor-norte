// Data contracts used by the routes. Routes depend on these interfaces only, so HTTP tests use
// in-memory fakes (server/tests/fakes.ts) and production uses PostgreSQL (the *.ts files next to this).

import type { Permissao } from '../auth/api-keys.ts';

export type Idioma = 'pt' | 'en';
export const IDIOMAS: readonly Idioma[] = ['pt', 'en'];

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  idioma: Idioma;
}

export interface RepositorioContas {
  /** User by e-mail (case-insensitive), with what login needs. Null if it does not exist. */
  buscarParaLogin(email: string): Promise<(Usuario & { senhaHash: string; ativo: boolean }) | null>;
  registrarLogin(usuarioId: string): Promise<void>;
  criarSessao(s: { usuarioId: string; tokenHash: string; expiraEm: Date; ip: string | null; userAgent: string | null }): Promise<void>;
  /** Session that is not expired, not idle for longer than `inatividadeMs`, and whose user is active. */
  sessaoValida(tokenHash: string, inatividadeMs: number): Promise<{ sessaoId: string; usuario: Usuario } | null>;
  /** Refreshes the idle timer. Best effort. */
  tocarSessao(sessaoId: string): Promise<void>;
  encerrarSessao(tokenHash: string): Promise<void>;
  definirIdioma(usuarioId: string, idioma: Idioma): Promise<void>;
  /** Current password hash (for the "change my password" check). */
  hashDaSenha(usuarioId: string): Promise<string | null>;
  /** Sets a new password and ends every other session of the user (keeps `manterSessaoId`). */
  alterarSenha(usuarioId: string, senhaHash: string, manterSessaoId: string): Promise<void>;
  purgarSessoesExpiradas(inatividadeMs: number): Promise<number>;
}

export interface Pagina<T> {
  itens: T[];
  total: number;
  pagina: number;
  porPagina: number;
}

export interface Paginacao {
  pagina: number;
  porPagina: number;
}

export interface ReferenciaChave {
  id: string;
  nome: string;
  prefixo: string;
}

export interface ReferenciaUsuario {
  id: string;
  nome: string;
}

export interface FiltrosLogs extends Paginacao {
  de?: string;
  ate?: string;
  origem?: 'api' | 'dashboard';
  status?: number;
  busca?: string;
  apiKeyId?: string;
}

export interface LogErro {
  id: string;
  ocorridoEm: string;
  origem: 'api' | 'dashboard';
  metodo: string | null;
  rota: string | null;
  statusHttp: number | null;
  mensagem: string;
  requestId: string | null;
  apiKey: ReferenciaChave | null;
}

export interface LogErroDetalhado extends LogErro {
  detalhes: Record<string, unknown> | null;
}

export interface FiltrosDownloads extends Paginacao {
  de?: string;
  ate?: string;
  protocolo?: string;
  tipo?: 'binario' | 'base64' | 'envio';
  resultado?: 'ok' | 'nao_encontrado' | 'sem_pdf' | 'erro';
  apiKeyId?: string;
}

export interface Download {
  id: string;
  ocorridoEm: string;
  protocolo: string;
  tipo: 'binario' | 'base64' | 'envio';
  destino: string | null;
  resultado: 'ok' | 'nao_encontrado' | 'sem_pdf' | 'erro';
  tamanhoBytes: number | null;
  duracaoMs: number | null;
  /** Key that made the request, and the user who created that key. */
  apiKey: (ReferenciaChave & { criadaPor: ReferenciaUsuario | null }) | null;
}

export interface FiltrosConsultas extends Paginacao {
  de?: string;
  ate?: string;
  /** HMAC of the CPF typed in the filter (computed by the route; the CPF itself never reaches the query). */
  cpfHash?: string;
  /** Calls that returned this protocol number. */
  protocolo?: string;
  resultado?: 'ok' | 'erro';
  apiKeyId?: string;
}

/** One GET /protocolos call made to the API. */
export interface Consulta {
  id: string;
  ocorridoEm: string;
  /** e.g. 529.***.***-25 (the full CPF is not stored). */
  cpfMascarado: string;
  /** Listing filters used besides the CPF, or null. */
  filtros: Record<string, string> | null;
  resultado: 'ok' | 'erro';
  /** Number of protocols returned (null on error). */
  quantidade: number | null;
  protocolos: string[];
  duracaoMs: number | null;
  apiKey: (ReferenciaChave & { criadaPor: ReferenciaUsuario | null }) | null;
}

export interface RegistroErroDashboard {
  metodo: string;
  rota: string | null;
  statusHttp: number;
  mensagem: string;
  detalhes?: Record<string, unknown>;
  requestId?: string;
}

export interface RepositorioMonitoramento {
  listarLogs(filtros: FiltrosLogs): Promise<Pagina<LogErro>>;
  obterLog(id: string): Promise<LogErroDetalhado | null>;
  listarDownloads(filtros: FiltrosDownloads): Promise<Pagina<Download>>;
  listarConsultas(filtros: FiltrosConsultas): Promise<Pagina<Consulta>>;
  /** Writes a dashboard error to logs_erro (origem = 'dashboard'). Fire-and-forget, never throws. */
  registrarErro(registro: RegistroErroDashboard): void;
}

export interface ChaveApiResumo {
  id: string;
  nome: string;
  prefixo: string;
  permissoes: Permissao[];
  limitePorMinuto: number | null;
  criadaEm: string;
  ultimoUsoEm: string | null;
  revogadaEm: string | null;
  criadaPor: ReferenciaUsuario | null;
  revogadaPor: ReferenciaUsuario | null;
}

export interface NovaChave {
  nome: string;
  prefixo: string;
  hash: string;
  permissoes: Permissao[];
  limitePorMinuto: number | null;
  criadoPor: string;
}

export interface AlteracaoChave {
  nome?: string;
  permissoes?: Permissao[];
  /** null = back to the API's global default. */
  limitePorMinuto?: number | null;
}

export type ResultadoAlteracaoChave =
  | { tipo: 'ok'; chave: ChaveApiResumo }
  | { tipo: 'nao_encontrada' }
  | { tipo: 'revogada' };

export interface RepositorioChaves {
  listar(): Promise<ChaveApiResumo[]>;
  criar(nova: NovaChave): Promise<ChaveApiResumo>;
  /** Only active keys can be changed. */
  alterar(id: string, alteracao: AlteracaoChave): Promise<ResultadoAlteracaoChave>;
  revogar(id: string, usuarioId: string): Promise<ResultadoAlteracaoChave>;
}

export interface Repositorios {
  contas: RepositorioContas;
  monitoramento: RepositorioMonitoramento;
  chaves: RepositorioChaves;
}
