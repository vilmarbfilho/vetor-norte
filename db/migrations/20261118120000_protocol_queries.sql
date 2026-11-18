-- migrate:up

-- History of GET /protocolos calls (which key listed which CPF's protocols).
-- LGPD: the CPF is never stored in clear. cpf_mascarado is for display (529.***.***-25); cpf_hash is
-- HMAC-SHA256(CPF_HMAC_CHAVE, 11 digits) in hex, so the dashboard can search by a full CPF without the
-- database (or its backups) revealing it. Same key in API and dashboard; changing it breaks old searches.
CREATE TABLE consultas_protocolos (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ocorrido_em    timestamptz NOT NULL DEFAULT now(),
  cpf_mascarado  text        NOT NULL,
  cpf_hash       text        NOT NULL,
  filtros        jsonb,                        -- listing filters used (without the CPF); null when none
  resultado      text        NOT NULL CHECK (resultado IN ('ok', 'erro')),
  quantidade     integer,                      -- protocols returned; null on error
  protocolos     text[]      NOT NULL DEFAULT '{}', -- protocol numbers returned
  duracao_ms     integer,
  api_key_id     uuid        REFERENCES api_keys (id) ON DELETE SET NULL
);
CREATE INDEX consultas_protocolos_ocorrido_em ON consultas_protocolos (ocorrido_em DESC);
CREATE INDEX consultas_protocolos_api_key ON consultas_protocolos (api_key_id, ocorrido_em DESC);
CREATE INDEX consultas_protocolos_cpf ON consultas_protocolos (cpf_hash, ocorrido_em DESC);
CREATE INDEX consultas_protocolos_protocolos ON consultas_protocolos USING gin (protocolos);

-- migrate:down

DROP TABLE consultas_protocolos;
