-- migrate:up

-- Dashboard users (people who log in to the dashboard).
CREATE TABLE usuarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text        NOT NULL,
  email         text        NOT NULL,
  senha_hash    text        NOT NULL,          -- password hash (algorithm chosen in the dashboard stage)
  ativo         boolean     NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  ultimo_login  timestamptz
);
-- Case-insensitive unique e-mail.
CREATE UNIQUE INDEX usuarios_email_unico ON usuarios (lower(email));

-- API keys used to call the API. The full key is shown once at creation; only its hash is stored.
CREATE TABLE api_keys (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome               text        NOT NULL,
  prefixo            text        NOT NULL,     -- visible part (e.g. "vn_ab12cd") to identify the key in the UI
  hash               text        NOT NULL UNIQUE, -- SHA-256 (hex) of the full key; keys are random, so a fast hash is enough
  permissoes         text[]      NOT NULL DEFAULT '{}',
  limite_por_minuto  integer     CHECK (limite_por_minuto IS NULL OR limite_por_minuto > 0), -- NULL = global default
  criado_por         uuid        REFERENCES usuarios (id) ON DELETE SET NULL,
  criada_em          timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_em      timestamptz,
  revogada_em        timestamptz,
  revogada_por       uuid        REFERENCES usuarios (id) ON DELETE SET NULL,
  -- Only known permissions are accepted.
  CONSTRAINT api_keys_permissoes_validas
    CHECK (permissoes <@ ARRAY['protocolos:listar', 'pdf:baixar', 'pdf:enviar']::text[])
);

-- Errors that happened in the API or the dashboard. Personal data (CPF) must be masked before insert.
CREATE TABLE logs_erro (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ocorrido_em  timestamptz NOT NULL DEFAULT now(),
  origem       text        NOT NULL CHECK (origem IN ('api', 'dashboard')),
  metodo       text,
  rota         text,
  status_http  smallint,
  mensagem     text        NOT NULL,
  detalhes     jsonb,
  api_key_id   uuid        REFERENCES api_keys (id) ON DELETE SET NULL,
  request_id   text
);
-- Listing (newest first) and retention purge both filter by date.
CREATE INDEX logs_erro_ocorrido_em ON logs_erro (ocorrido_em DESC);

-- History of PDF requests (download as binary/base64, or delivery to a destination).
CREATE TABLE downloads_pdf (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ocorrido_em    timestamptz NOT NULL DEFAULT now(),
  protocolo      text        NOT NULL,
  tipo           text        NOT NULL CHECK (tipo IN ('binario', 'base64', 'envio')),
  destino        text,                         -- destination name when tipo = 'envio'
  resultado      text        NOT NULL CHECK (resultado IN ('ok', 'nao_encontrado', 'sem_pdf', 'erro')),
  tamanho_bytes  integer,
  duracao_ms     integer,
  api_key_id     uuid        REFERENCES api_keys (id) ON DELETE SET NULL
);
CREATE INDEX downloads_pdf_ocorrido_em ON downloads_pdf (ocorrido_em DESC);
CREATE INDEX downloads_pdf_api_key ON downloads_pdf (api_key_id, ocorrido_em DESC);
CREATE INDEX downloads_pdf_protocolo ON downloads_pdf (protocolo);

-- migrate:down

DROP TABLE downloads_pdf;
DROP TABLE logs_erro;
DROP TABLE api_keys;
DROP TABLE usuarios;
