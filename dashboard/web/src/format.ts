// Formatting and filter helpers (pure, unit-tested).

export function formatarDataHora(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(iso));
}

export function formatarBytes(bytes: number | null, locale: string): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return bytes < 1024 * 1024 ? `${n.format(bytes / 1024)} KB` : `${n.format(bytes / 1024 / 1024)} MB`;
}

export function formatarDuracao(ms: number | null, locale: string): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(ms / 1000)} s`;
}

/** <input type="date"> value (local day) -> ISO instant at the start of that day. */
export function inicioDoDia(data: string): string {
  return new Date(`${data}T00:00:00`).toISOString();
}

/** <input type="date"> value (local day) -> ISO instant at the end of that day (inclusive filter). */
export function fimDoDia(data: string): string {
  return new Date(`${data}T23:59:59.999`).toISOString();
}

/**
 * Converts the page filters (kept in the URL as plain values, e.g. de=2026-11-01) into the API query:
 * date-only values become ISO instants in the user's time zone; empty values are dropped.
 */
export function consultaDaApi(filtros: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of filtros) {
    if (!v) continue;
    if (k === 'de') q.set(k, inicioDoDia(v));
    else if (k === 'ate') q.set(k, fimDoDia(v));
    else q.set(k, v);
  }
  return q;
}

export function primeiraLinha(texto: string, max = 140): string {
  const linha = texto.split('\n')[0] ?? '';
  return linha.length > max ? `${linha.slice(0, max)}…` : linha;
}
