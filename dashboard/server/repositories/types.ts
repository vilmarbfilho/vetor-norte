// Data contracts used by the routes. Routes depend on these interfaces only, so HTTP tests use
// in-memory fakes (server/tests/fakes.ts) and production uses PostgreSQL (the *.ts files next to this).

import type { Perfil, Tela } from '../auth/access.ts';
import type { Permissao } from '../auth/api-keys.ts';

export type Idioma = 'pt' | 'en';
export const IDIOMAS: readonly Idioma[] = ['pt', 'en'];

/** Logged-in user, read from the database on every request (permission changes apply at once). */
export interface Usuario {
  id: string;
  nome: string;
  email: string;
  idioma: Idioma;
  perfil: Perfil;
  /** Screens granted to a corretor (ignored for admins). */
  telas: Tela[];
  /** Ceiling for the user's API keys (ignored for admins). */
  permissoesApi: Permissao[];
  /** Temporary password set by an admin: everything but changing it is blocked. */
  trocarSenha: boolean;
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
  /** Sets a new password (clears `trocarSenha`) and ends every other session of the user (keeps `manterSessaoId`). */
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
  usuarioId?: string;
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
  /** User whose key made the request (API) or who was logged in (dashboard). */
  usuario: ReferenciaUsuario | null;
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
  /** Owner filter. Forced to the logged-in user for corretores. */
  usuarioId?: string;
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
  apiKey: ReferenciaChave | null;
  /** Owner of the key at request time. */
  usuario: ReferenciaUsuario | null;
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
  /** Owner filter. Forced to the logged-in user for corretores. */
  usuarioId?: string;
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
  apiKey: ReferenciaChave | null;
  /** Owner of the key at request time. */
  usuario: ReferenciaUsuario | null;
}

export interface RegistroErroDashboard {
  metodo: string;
  rota: string | null;
  statusHttp: number;
  mensagem: string;
  detalhes?: Record<string, unknown>;
  requestId?: string;
  /** Logged-in user, when there was one. */
  usuarioId?: string | null;
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
  /** Owner: the API uses this user's permissions ceiling and portal credentials. */
  dono: ReferenciaUsuario;
  criadaPor: ReferenciaUsuario | null;
  revogadaPor: ReferenciaUsuario | null;
}

export interface NovaChave {
  nome: string;
  prefixo: string;
  hash: string;
  permissoes: Permissao[];
  limitePorMinuto: number | null;
  usuarioId: string;
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
  /** All keys, or only the keys owned by `usuarioId`. */
  listar(filtro?: { usuarioId?: string }): Promise<ChaveApiResumo[]>;
  obter(id: string): Promise<ChaveApiResumo | null>;
  criar(nova: NovaChave): Promise<ChaveApiResumo>;
  /** Only active keys can be changed. */
  alterar(id: string, alteracao: AlteracaoChave): Promise<ResultadoAlteracaoChave>;
  revogar(id: string, usuarioId: string): Promise<ResultadoAlteracaoChave>;
}

/** A user as admins see it in user management. */
export interface UsuarioResumo extends Usuario {
  ativo: boolean;
  criadoEm: string;
  ultimoLogin: string | null;
  /** Broker portal credentials status (null = not registered). */
  credencialPortal: ResumoCredencial | null;
}

/**
 * Broker portal credentials as the dashboard shows them. The password is never part of it.
 * Status: 'nao_testada' (saved, not used yet), 'valida' (last portal login worked), 'invalida' (the portal
 * rejected it: the API stops trying until it is updated). The API sets valida/invalida (stage 17).
 */
export type StatusCredencial = 'nao_testada' | 'valida' | 'invalida';

export interface ResumoCredencial {
  emailPortal: string;
  status: StatusCredencial;
  atualizadaEm: string;
  atualizadaPor: ReferenciaUsuario | null;
  ultimoLoginOkEm: string | null;
  invalidadaEm: string | null;
}

export interface RepositorioCredenciais {
  obter(usuarioId: string): Promise<ResumoCredencial | null>;
  /**
   * Creates or replaces the user's credentials (`senhaCifrada` from credentials-crypto.ts) and resets the
   * status to 'nao_testada'. Returns null if the user does not exist.
   */
  salvar(c: { usuarioId: string; emailPortal: string; senhaCifrada: Buffer; atualizadaPor: string }): Promise<ResumoCredencial | null>;
}

export interface NovoUsuario {
  nome: string;
  email: string;
  perfil: Perfil;
  telas: Tela[];
  permissoesApi: Permissao[];
  /** Hash of the generated temporary password (the user must change it at the first login). */
  senhaHash: string;
}

export interface AlteracaoUsuario {
  nome?: string;
  email?: string;
  perfil?: Perfil;
  telas?: Tela[];
  permissoesApi?: Permissao[];
}

export type ResultadoUsuario =
  | { tipo: 'ok'; usuario: UsuarioResumo }
  | { tipo: 'nao_encontrado' }
  | { tipo: 'email_em_uso' };

export interface RepositorioUsuarios {
  listar(): Promise<UsuarioResumo[]>;
  obter(id: string): Promise<UsuarioResumo | null>;
  criar(novo: NovoUsuario): Promise<ResultadoUsuario>;
  /**
   * Changes data and permissions. When the user ends up as a corretor, API permissions outside the new
   * ceiling are also removed from their keys, permanently (granting them again does not restore them).
   */
  alterar(id: string, alteracao: AlteracaoUsuario): Promise<ResultadoUsuario>;
  /** Deactivating ends the user's dashboard sessions (the API rejects their keys too). */
  definirAtivo(id: string, ativo: boolean): Promise<ResultadoUsuario>;
  /** New temporary password: sets `trocarSenha` and ends every session of the user. */
  redefinirSenha(id: string, senhaHash: string): Promise<ResultadoUsuario>;
}

export interface Repositorios {
  contas: RepositorioContas;
  usuarios: RepositorioUsuarios;
  credenciais: RepositorioCredenciais;
  monitoramento: RepositorioMonitoramento;
  chaves: RepositorioChaves;
}
