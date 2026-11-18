-- migrate:up

-- Dashboard UI language, chosen by each user in the interface.
ALTER TABLE usuarios
  ADD COLUMN idioma text NOT NULL DEFAULT 'pt' CHECK (idioma IN ('pt', 'en'));

-- Dashboard login sessions (httpOnly cookie). Only the SHA-256 hash of the cookie token is stored.
CREATE TABLE sessoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     uuid        NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  token_hash     text        NOT NULL UNIQUE,
  criada_em      timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_em  timestamptz NOT NULL DEFAULT now(),  -- idle timeout is checked against this
  expira_em      timestamptz NOT NULL,                -- absolute limit, regardless of activity
  ip             text,
  user_agent     text
);
CREATE INDEX sessoes_usuario ON sessoes (usuario_id);
CREATE INDEX sessoes_expira_em ON sessoes (expira_em);

-- migrate:down

DROP TABLE sessoes;
ALTER TABLE usuarios DROP COLUMN idioma;
