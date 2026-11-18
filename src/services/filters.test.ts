import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Protocolo } from '../scraper/portal.ts';
import { protocoloFake } from '../tests/fixtures.ts';
import { aplicarFiltros, chaveData } from './filters.ts';

const lista = [
  protocoloFake({ protocolo: '1', dataProtocolo: '09/04/2026 09:08:03', seguradora: 'Tokio Marine Seguradora' }),
  protocoloFake({ protocolo: '2', dataProtocolo: '12/01/2023 16:16:41', statusProtocolo: 'RECUSADO' }),
  protocoloFake({ protocolo: '3', dataProtocolo: '14/05/2018 09:05:37', statusProposta: 'Cancelada a Apólice' }),
];
const numeros = (r: Protocolo[]) => r.map((p) => p.protocolo);

test('chaveData aceita formato BR, com hora, e ISO', () => {
  assert.equal(chaveData('17/11/2026 09:12:18'), '20261117');
  assert.equal(chaveData('17/11/2026'), '20261117');
  assert.equal(chaveData('2026-11-17'), '20261117');
  assert.equal(chaveData(''), null);
});

test('sem filtros retorna tudo', () => {
  assert.deepEqual(numeros(aplicarFiltros(lista, {})), ['1', '2', '3']);
});

test('filtro por número de protocolo é exato', () => {
  assert.deepEqual(numeros(aplicarFiltros(lista, { protocolo: '2' })), ['2']);
});

test('intervalo de data é inclusivo e aceita ISO ou BR', () => {
  assert.deepEqual(numeros(aplicarFiltros(lista, { dataProtocoloDe: '2023-01-12' })), ['1', '2']);
  assert.deepEqual(numeros(aplicarFiltros(lista, { dataProtocoloAte: '12/01/2023' })), ['2', '3']);
});

test('textos: contém, sem maiúsculas nem acentos', () => {
  assert.deepEqual(numeros(aplicarFiltros(lista, { seguradora: 'tokio' })), ['1']);
  assert.deepEqual(numeros(aplicarFiltros(lista, { statusProtocolo: 'recusado' })), ['2']);
  assert.deepEqual(numeros(aplicarFiltros(lista, { statusProposta: 'cancelada a apolice' })), ['3']);
  assert.deepEqual(numeros(aplicarFiltros(lista, { segurado: 'jose' })), ['1', '2', '3']);
});

test('filtros combinados (E)', () => {
  assert.deepEqual(numeros(aplicarFiltros(lista, { seguradora: 'allianz', dataProtocoloDe: '2020-01-01' })), ['2']);
});
