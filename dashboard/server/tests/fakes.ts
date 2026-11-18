// In-memory repositories for HTTP tests (no database).
import { randomUUID } from 'node:crypto';
import type {
  AlteracaoChave, AlteracaoUsuario, ChaveApiResumo, Download, FiltrosDownloads, FiltrosLogs, Idioma, LogErro,
  LogErroDetalhado, NovaChave, NovoUsuario, Pagina, RegistroErroDashboard, RepositorioChaves, RepositorioContas,
  RepositorioCredenciais, RepositorioMonitoramento, RepositorioUsuarios, ResultadoAlteracaoChave, ResultadoUsuario,
  ResumoCredencial, Usuario, UsuarioResumo,
  Consulta, FiltrosConsultas,
} from '../repositories/types.ts';

export interface UsuarioFake extends Usuario { senhaHash: string; ativo: boolean }

/** Test user with defaults (corretor, nothing granted). */
export function usuarioFake(u: Partial<UsuarioFake> & Pick<UsuarioFake, 'id' | 'email' | 'senhaHash'>): UsuarioFake {
  return {
    nome: u.id, idioma: 'pt', perfil: 'corretor', telas: [], permissoesApi: [], trocarSenha: false, ativo: true, ...u,
  };
}

function publico(u: UsuarioFake): Usuario {
  const { senhaHash: _h, ativo: _a, ...resto } = u;
  return { ...resto, telas: [...resto.telas], permissoesApi: [...resto.permissoesApi] };
}

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
    return { sessaoId: s.id, usuario: publico(u) };
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
    const u = this.usuarios.find((x) => x.id === usuarioId)!;
    u.senhaHash = senhaHash;
    u.trocarSenha = false;
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

/** User management over the same user list as ContasFake (and the keys, to strip permissions). */
export class UsuariosFake implements RepositorioUsuarios {
  constructor(
    private readonly contas: ContasFake,
    private readonly chaves: ChavesFake,
    private readonly credenciais?: CredenciaisFake,
  ) {}

  private resumo(u: UsuarioFake): UsuarioResumo {
    return {
      ...publico(u), ativo: u.ativo, criadoEm: '2026-11-18T00:00:00.000Z', ultimoLogin: null,
      credencialPortal: this.credenciais?.resumo(u.id) ?? null,
    };
  }
  private ok(u: UsuarioFake): ResultadoUsuario {
    return { tipo: 'ok', usuario: this.resumo(u) };
  }
  private emailEmUso(email: string, exceto?: string) {
    return this.contas.usuarios.some((u) => u.email.toLowerCase() === email.toLowerCase() && u.id !== exceto);
  }
  private encerrarSessoes(id: string) {
    for (const [k, s] of this.contas.sessoes) if (s.usuarioId === id) this.contas.sessoes.delete(k);
  }

  async listar() {
    return this.contas.usuarios.map((u) => this.resumo(u));
  }
  async obter(id: string) {
    const u = this.contas.usuarios.find((x) => x.id === id);
    return u ? this.resumo(u) : null;
  }
  async criar(n: NovoUsuario): Promise<ResultadoUsuario> {
    if (this.emailEmUso(n.email)) return { tipo: 'email_em_uso' };
    const u = usuarioFake({ id: randomUUID(), ...n, trocarSenha: true });
    this.contas.usuarios.push(u);
    return this.ok(u);
  }
  async alterar(id: string, a: AlteracaoUsuario): Promise<ResultadoUsuario> {
    const u = this.contas.usuarios.find((x) => x.id === id);
    if (!u) return { tipo: 'nao_encontrado' };
    if (a.email && this.emailEmUso(a.email, id)) return { tipo: 'email_em_uso' };
    Object.assign(u, a);
    if (u.perfil === 'corretor') {
      for (const c of this.chaves.chaves) {
        if (c.dono.id === id && !c.revogadaEm) c.permissoes = c.permissoes.filter((p) => u.permissoesApi.includes(p));
      }
    }
    return this.ok(u);
  }
  async definirAtivo(id: string, ativo: boolean): Promise<ResultadoUsuario> {
    const u = this.contas.usuarios.find((x) => x.id === id);
    if (!u) return { tipo: 'nao_encontrado' };
    u.ativo = ativo;
    if (!ativo) this.encerrarSessoes(id);
    return this.ok(u);
  }
  async redefinirSenha(id: string, senhaHash: string): Promise<ResultadoUsuario> {
    const u = this.contas.usuarios.find((x) => x.id === id);
    if (!u) return { tipo: 'nao_encontrado' };
    Object.assign(u, { senhaHash, trocarSenha: true });
    this.encerrarSessoes(id);
    return this.ok(u);
  }
}

export class ChavesFake implements RepositorioChaves {
  chaves: (ChaveApiResumo & { hash: string })[] = [];

  async listar(filtro: { usuarioId?: string } = {}) {
    return this.chaves
      .filter((c) => !filtro.usuarioId || c.dono.id === filtro.usuarioId)
      .map(({ hash: _h, ...c }) => c);
  }
  async obter(id: string) {
    return (await this.listar()).find((c) => c.id === id) ?? null;
  }
  async criar(n: NovaChave) {
    const c = {
      id: randomUUID(), nome: n.nome, prefixo: n.prefixo, hash: n.hash, permissoes: n.permissoes,
      limitePorMinuto: n.limitePorMinuto, criadaEm: new Date().toISOString(), ultimoUsoEm: null, revogadaEm: null,
      dono: { id: n.usuarioId, nome: 'x' }, criadaPor: { id: n.criadoPor, nome: 'x' }, revogadaPor: null,
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

/** Portal credentials in memory. Keeps the encrypted bytes so tests can check them. */
export class CredenciaisFake implements RepositorioCredenciais {
  linhas = new Map<string, ResumoCredencial & { senhaCifrada: Buffer }>();
  constructor(private readonly contas: ContasFake) {}

  resumo(usuarioId: string): ResumoCredencial | null {
    const l = this.linhas.get(usuarioId);
    if (!l) return null;
    const { senhaCifrada: _s, ...resumo } = l;
    return resumo;
  }
  async obter(usuarioId: string) {
    return this.resumo(usuarioId);
  }
  async salvar(c: { usuarioId: string; emailPortal: string; senhaCifrada: Buffer; atualizadaPor: string }) {
    if (!this.contas.usuarios.some((u) => u.id === c.usuarioId)) return null;
    const por = this.contas.usuarios.find((u) => u.id === c.atualizadaPor)!;
    this.linhas.set(c.usuarioId, {
      emailPortal: c.emailPortal, senhaCifrada: c.senhaCifrada, status: 'nao_testada',
      atualizadaEm: new Date().toISOString(), atualizadaPor: { id: por.id, nome: por.nome },
      ultimoLoginOkEm: null, invalidadaEm: null,
    });
    return this.resumo(c.usuarioId);
  }
}
