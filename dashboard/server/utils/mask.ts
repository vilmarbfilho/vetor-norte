// LGPD: CPF masking for anything the dashboard writes to logs.
// Same rule as api/src/audit/mask.ts (529.982.247-25 -> 529.***.***-25). Keep both in sync.

const CPF = /(?<!\d)(\d{3})\.?\d{3}\.?\d{3}-?(\d{2})(?!\d)/g;
const CORES_ANSI = /\x1b\[[0-9;]*m/g;

export function mascararCpf(texto: string): string {
  return texto.replace(CPF, '$1.***.***-$2');
}

/** Masks, strips terminal colors and truncates, for free-text fields stored in the database. */
export function textoSeguro(texto: string, limite = 2000): string {
  const mascarado = mascararCpf(texto.replace(CORES_ANSI, ''));
  return mascarado.length > limite ? `${mascarado.slice(0, limite)}…` : mascarado;
}
