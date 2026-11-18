// Keep-alive scheduling logic (fake session and clock, no browser).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeepAlive, type SessaoVerificavel } from './keepalive.ts';

const MIN = 60_000;

function montar(opcoes: { falhar?: boolean } = {}) {
  let agora = 0;
  let ultimaAtividade: number | null = null;
  const estado = { verificacoes: 0, falhas: [] as Error[] };
  let liberar: (() => void) | undefined;
  const sessao: SessaoVerificavel = {
    ociosaHaMs: (t = agora) => (ultimaAtividade === null ? Infinity : t - ultimaAtividade),
    async verificar() {
      estado.verificacoes++;
      if (opcoes.falhar) throw new Error('portal fora do ar');
      ultimaAtividade = agora;
    },
  };
  const ka = new KeepAlive(sessao, { intervaloMs: 10 * MIN, aoFalhar: (e) => estado.falhas.push(e), agora: () => agora });
  return {
    ka, estado,
    avancar: (ms: number) => (agora += ms),
    atividade: () => (ultimaAtividade = agora),
    sessaoLenta: () => {
      sessao.verificar = () => new Promise<void>((ok) => (liberar = ok));
      return () => liberar!();
    },
  };
}

test('sem atividade anterior: verifica (abre a sessão)', async () => {
  const { ka, estado } = montar();
  assert.equal(await ka.tick(), true);
  assert.equal(estado.verificacoes, 1);
});

test('atividade recente pula a verificação; ociosa além do intervalo verifica', async () => {
  const { ka, estado, avancar, atividade } = montar();
  atividade();
  avancar(9 * MIN);
  assert.equal(await ka.tick(), false);
  avancar(1 * MIN);
  assert.equal(await ka.tick(), true);
  assert.equal(estado.verificacoes, 1);
  // The check itself counts as activity.
  avancar(5 * MIN);
  assert.equal(await ka.tick(), false);
});

test('falha chama aoFalhar e não lança', async () => {
  const { ka, estado } = montar({ falhar: true });
  assert.equal(await ka.tick(), true);
  assert.equal(estado.falhas.length, 1);
  assert.equal(estado.falhas[0]!.message, 'portal fora do ar');
});

test('não roda duas verificações ao mesmo tempo', async () => {
  const { ka, estado, sessaoLenta } = montar();
  const liberar = sessaoLenta();
  const primeira = ka.tick();
  assert.equal(await ka.tick(), false);
  liberar();
  assert.equal(await primeira, true);
  assert.equal(estado.verificacoes, 0); // the slow fake does not count
});
