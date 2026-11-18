// Banner shown when a list is filtered by one API key (coming from the keys page).
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useIdioma } from '../i18n';

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
