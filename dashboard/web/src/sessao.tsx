// Logged-in user for every page (profile decides columns, filters and actions), plus the user list that
// admin-only selects (owner filters, key owner) need.
import { createContext, useContext, useEffect, useState } from 'react';
import { api, type Usuario, type UsuarioResumo } from './api';
import { ehAdmin } from './acesso';

const Contexto = createContext<Usuario | null>(null);
export const ProvedorUsuario = Contexto.Provider;

export function useUsuarioAtual(): Usuario {
  const u = useContext(Contexto);
  if (!u) throw new Error('useUsuarioAtual fora do ProvedorUsuario');
  return u;
}

/** All users, for admins (empty for corretores, who cannot list users). Loaded once per page. */
export function useListaUsuarios(): UsuarioResumo[] {
  const admin = ehAdmin(useUsuarioAtual());
  const [usuarios, setUsuarios] = useState<UsuarioResumo[]>([]);
  useEffect(() => {
    if (!admin) return;
    api.usuarios().then((r) => setUsuarios(r.usuarios)).catch(() => setUsuarios([]));
  }, [admin]);
  return usuarios;
}
