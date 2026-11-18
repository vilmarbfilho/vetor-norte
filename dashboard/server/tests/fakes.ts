// In-memory repositories for HTTP tests (no database).
import { randomUUID } from 'node:crypto';
import type {
  AlteracaoChave, ChaveApiResumo, Download, FiltrosDownloads, FiltrosLogs, Idioma, LogErro, LogErroDetalhado,
  NovaChave, Pagina, RegistroErroDashboard, RepositorioChaves, RepositorioContas, RepositorioMonitoramento,
  ResultadoAlteracaoChave, Usuario, Consulta, FiltrosConsultas,
} from '../repositories/types.ts';

interface UsuarioFake extends Usuario { senhaHash: string; ativo: boolean }

export class ContasFake implements RepositorioContas {
  usuarios: UsuarioFake[] = [];
  sessoes = new Map<string, { id: string; usuarioId: string; expiraEm: Date; ultimoUso: number }>();
  agora = () => Date.now();

  async buscarParaLogin(email: string) {
    return this.usuarios.find((u) => u.email.toLowerCase() === email.trim().toLowerCase()) ?? null;
  }
  async registrarLogin() {}
  async criarSessao(s: { usuarioId: string; tokenHash: string; expiraEm: Date }) {
    this.sessoes.set(s.tokenHash, { id: randomUUID(), usuarioId: s.usuarioId, expiraEm: s.expiraEm, ultimoUso: this.agora() });
  }
  async sessaoValida(tokenHash: string, inatividadeMs: number) {
    const s = this.sessoes.get(tokenHash);
    const u = s && this.usuarios.find((x) => x.id === s.usuarioId);
    if (!s || !u || !u.ativo || s.expiraEm.getTime() <= this.agora() || this.agora() - s.ultimoUso >= inatividadeMs) return null;
    const { id, nome, email, idioma } = u;
    return { sessaoId: s.id, usuario: { id, nome, email, idioma } };
  }
  async tocarSessao(sessaoId: string) {
    for (const s of this.sessoes.values()) if (s.id === sessaoId) s.ultimoUso = this.agora();
  }
  async encerrarSessao(tokenHash: string) {
    this.sessoes.delete(tokenHash);
  }
  async definirIdioma(usuarioId: string, idioma: Idioma) {
    this.usuarios.find((u) => u.id === usuarioId)!.idioma = idioma;
  }
  async hashDaSenha(usuarioId: string) {
    return this.usuarios.find((u) => u.id === usuarioId)?.senhaHash ?? null;
  }
  async alterarSenha(usuarioId: string, senhaHash: string, manterSessaoId: string) {
    this.usuarios.find((u) => u.id === usuarioId)!.senhaHash = senhaHash;
    for (const [k, s] of this.sessoes) if (s.usuarioId === usuarioId && s.id !== manterSessaoId) this.sessoes.delete(k);
  }
  async purgarSessoesExpiradas() {
    return 0;
  }
}

export class MonitoramentoFake implements RepositorioMonitoramento {
  erros: RegistroErroDashboard[] = [];
  ultimosFiltros: unknown;
  falharListagem = false;
  logs: LogErroDetalhado[] = [];

  async listarLogs(f: FiltrosLogs): Promise<Pagina<LogErro>> {
    if (this.falharListagem) throw new Error('banco fora do ar ao buscar 529.982.247-25');
    this.ultimosFiltros = f;
    return { itens: this.logs, total: this.logs.length, pagina: f.pagina, porPagina: f.porPagina };
  }
  async obterLog(id: string) {
    return this.logs.find((l) => l.id === id) ?? null;
  }
  async listarDownloads(f: FiltrosDownloads): Promise<Pagina<Download>> {
    this.ultimosFiltros = f;
    return { itens: [], total: 0, pagina: f.pagina, porPagina: f.porPagina };
  }
  async listarConsultas(f: FiltrosConsultas): Promise<Pagina<Consulta>> {
    this.ultimosFiltros = f;
    return { itens: [], total: 0, pagina: f.pagina, porPagina: f.porPagina };
  }
  registrarErro(r: RegistroErroDashboard) {
    this.erros.push(r);
  }
}

export class ChavesFake implements RepositorioChaves {
  chaves: (ChaveApiResumo & { hash: string })[] = [];

  async listar() {
    return this.chaves.map(({ hash: _h, ...c }) => c);
  }
  async criar(n: NovaChave) {
    const c = {
      id: randomUUID(), nome: n.nome, prefixo: n.prefixo, hash: n.hash, permissoes: n.permissoes,
      limitePorMinuto: n.limitePorMinuto, criadaEm: new Date().toISOString(), ultimoUsoEm: null, revogadaEm: null,
      criadaPor: { id: n.criadoPor, nome: 'x' }, revogadaPor: null,
    };
    this.chaves.push(c);
    const { hash: _h, ...publica } = c;
    return publica;
  }
  private alvo(id: string): ResultadoAlteracaoChave | (ChaveApiResumo & { hash: string }) {
    const c = this.chaves.find((x) => x.id === id);
    if (!c) return { tipo: 'nao_encontrada' };
    if (c.revogadaEm) return { tipo: 'revogada' };
    return c;
  }
  async alterar(id: string, a: AlteracaoChave): Promise<ResultadoAlteracaoChave> {
    const c = this.alvo(id);
    if ('tipo' in c) return c;
    Object.assign(c, a);
    const { hash: _h, ...publica } = c;
    return { tipo: 'ok', chave: publica };
  }
  async revogar(id: string, usuarioId: string): Promise<ResultadoAlteracaoChave> {
    const c = this.alvo(id);
    if ('tipo' in c) return c;
    c.revogadaEm = new Date().toISOString();
    c.revogadaPor = { id: usuarioId, nome: 'x' };
    const { hash: _h, ...publica } = c;
    return { tipo: 'ok', chave: publica };
  }
}
