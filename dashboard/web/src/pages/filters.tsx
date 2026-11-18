// Banner shown when a list is filtered by one API key (coming from the keys page).
import { useEffect, useState } from 'react';
import { api } from '../api';
import { ehAdmin } from '../acesso';
import { useIdioma } from '../i18n';
import { useListaUsuarios, useUsuarioAtual } from '../sessao';

export function FiltroChave({ apiKeyId, aoRemover }: { apiKeyId: string | null; aoRemover: () => void }) {
  const { t } = useIdioma();
  const [nome, setNome] = useState<string | null>(null);
  useEffect(() => {
    if (!apiKeyId) return;
    api.chaves()
      .then(({ chaves }) => {
        const c = chaves.find((k) => k.id === apiKeyId);
        setNome(c ? `${c.nome} (${c.prefixo}…)` : apiKeyId);
      })
      .catch(() => setNome(apiKeyId));
  }, [apiKeyId]);
  if (!apiKeyId) return null;
  return (
    <div className="alerta alerta-info faixa">
      <span>{t('comum.filtroChave', { chave: nome ?? '…' })}</span>
      <button type="button" className="botao-link" onClick={aoRemover}>{t('comum.removerFiltro')}</button>
    </div>
  );
}

/** Owner filter for admins (corretores only ever see their own rows, so they get nothing). */
export function CampoUsuario({ value, onChange }: { value: string; onChange: (e: { target: { value: string } }) => void }) {
  const { t } = useIdioma();
  const admin = ehAdmin(useUsuarioAtual());
  const usuarios = useListaUsuarios();
  if (!admin) return null;
  return (
    <label className="campo">
      <span>{t('comum.usuario')}</span>
      <select value={value} onChange={onChange}>
        <option value="">{t('comum.todos')}</option>
        {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
      </select>
    </label>
  );
}
