// API key management CLI. Temporary tool until the dashboard manages keys (later stage).
//
// Usage:
//   npm run chaves -- criar --nome "<name>" --permissoes protocolos:listar,pdf:baixar,pdf:enviar [--limite 30]
//   npm run chaves -- listar
//   npm run chaves -- revogar <prefixo>

import { parseArgs } from 'node:util';
import { gerarChave, PERMISSOES, permissaoValida } from '../auth/keys.ts';
// Only load.ts: this tool needs DATABASE_URL, not the portal credentials.
import { obrigatoria } from '../config/load.ts';
import { conectarBanco } from '../db/client.ts';

const USO = `Uso:
  npm run chaves -- criar --nome "<nome>" --permissoes <lista> [--limite <req/min>]
  npm run chaves -- listar
  npm run chaves -- revogar <prefixo>
Permissões: ${PERMISSOES.join(', ')}`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { nome: { type: 'string' }, permissoes: { type: 'string' }, limite: { type: 'string' } },
});
const [comando, argumento] = positionals;

function falhar(mensagem: string): never {
  console.error(`${mensagem}\n\n${USO}`);
  process.exit(1);
}

const sql = conectarBanco(obrigatoria('DATABASE_URL'));
try {
  switch (comando) {
    case 'criar': {
      const nome = values.nome?.trim();
      if (!nome) falhar('Informe --nome.');
      const permissoes = (values.permissoes ?? '').split(',').map((p) => p.trim()).filter(Boolean);
      if (permissoes.length === 0) falhar('Informe --permissoes.');
      const invalidas = permissoes.filter((p) => !permissaoValida(p));
      if (invalidas.length) falhar(`Permissões inválidas: ${invalidas.join(', ')}`);
      const limite = values.limite === undefined ? null : Number(values.limite);
      if (limite !== null && (!Number.isInteger(limite) || limite <= 0)) falhar('--limite deve ser um inteiro positivo.');

      const { chave, prefixo, hash } = gerarChave();
      await sql`
        INSERT INTO api_keys (nome, prefixo, hash, permissoes, limite_por_minuto)
        VALUES (${nome}, ${prefixo}, ${hash}, ${permissoes}, ${limite})
      `;
      console.log(`Chave criada: "${nome}" (${prefixo}…)`);
      console.log(`Permissões: ${permissoes.join(', ')}${limite ? ` | limite: ${limite} req/min` : ''}`);
      console.log('\nGuarde a chave abaixo agora. Ela NÃO será exibida novamente:\n');
      console.log(chave);
      break;
    }
    case 'listar': {
      const linhas = await sql<
        { prefixo: string; nome: string; permissoes: string[]; limite_por_minuto: number | null;
          criada_em: Date; ultimo_uso_em: Date | null; revogada_em: Date | null }[]
      >`
        SELECT prefixo, nome, permissoes, limite_por_minuto, criada_em, ultimo_uso_em, revogada_em
        FROM api_keys ORDER BY criada_em
      `;
      if (linhas.length === 0) console.log('Nenhuma chave cadastrada.');
      const data = (d: Date | null) => (d ? d.toLocaleString('pt-BR') : '-');
      console.table(
        linhas.map((l) => ({
          prefixo: l.prefixo,
          nome: l.nome,
          permissoes: l.permissoes.join(','),
          limite: l.limite_por_minuto ?? 'padrão',
          criada: data(l.criada_em),
          'último uso': data(l.ultimo_uso_em),
          status: l.revogada_em ? `revogada em ${data(l.revogada_em)}` : 'ativa',
        })),
      );
      break;
    }
    case 'revogar': {
      if (!argumento) falhar('Informe o prefixo da chave (veja "listar").');
      const ativas = await sql<{ id: string; nome: string }[]>`
        SELECT id, nome FROM api_keys WHERE prefixo = ${argumento} AND revogada_em IS NULL
      `;
      if (ativas.length === 0) falhar(`Nenhuma chave ativa com prefixo ${argumento}.`);
      if (ativas.length > 1) falhar(`Mais de uma chave ativa com prefixo ${argumento}; nada foi revogado.`);
      await sql`UPDATE api_keys SET revogada_em = now() WHERE id = ${ativas[0]!.id}`;
      console.log(`Chave "${ativas[0]!.nome}" (${argumento}) revogada. A API deixa de aceitá-la em até 10 s (cache).`);
      break;
    }
    default:
      falhar(comando ? `Comando desconhecido: ${comando}` : 'Informe um comando.');
  }
} finally {
  await sql.end({ timeout: 5 });
}
