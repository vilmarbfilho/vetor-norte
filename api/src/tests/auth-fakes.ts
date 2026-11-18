// In-memory API keys for HTTP tests (no database).
import { hashDaChave, type ChaveApi } from '../auth/keys.ts';
import type { RepositorioChaves } from '../auth/repository.ts';

/** Synthetic key with every permission, used by the route tests. */
export const CHAVE_TOTAL = 'vn_teste_todas_as_permissoes';

export class RepositorioChavesFake implements RepositorioChaves {
  readonly usos: string[] = [];
  /** When set, lookups throw (simulates the database being down). */
  falhar = false;
  private chaves = new Map<string, ChaveApi>();

  adicionar(segredo: string, chave: Partial<ChaveApi> & Pick<ChaveApi, 'id'>): this {
    this.chaves.set(hashDaChave(segredo), {
      nome: chave.id, prefixo: segredo.slice(0, 11), limitePorMinuto: null,
      permissoes: ['protocolos:listar', 'pdf:baixar', 'pdf:enviar'], ...chave,
    });
    return this;
  }

  async buscarPorHash(hash: string): Promise<ChaveApi | null> {
    if (this.falhar) throw new Error('banco fora do ar');
    return this.chaves.get(hash) ?? null;
  }

  registrarUso(id: string): void {
    this.usos.push(id);
  }
}
