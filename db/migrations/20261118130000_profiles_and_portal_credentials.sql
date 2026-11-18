-- migrate:up

-- Stage 13: user profiles (admin / corretor), per-user permissions, data ownership and
-- per-user Broker portal credentials (replacing PORTAL_EMAIL / PORTAL_SENHA in the API .env).

-- The system was not released yet: the owner agreed to drop all keys and history, so the new
-- ownership columns can be NOT NULL from the start. Users and dashboard sessions are kept.
TRUNCATE logs_erro, downloads_pdf, consultas_protocolos, api_keys;

-- Profile and permissions. Admins ignore `telas` and `permissoes_api` (they have full access).
-- `telas`: dashboard screens an admin granted to a corretor. "Erros" and "Usuarios" are admin-only and
-- "Minha conta" / "Credenciais do portal" are always available, so none of them is listed here.
-- `permissoes_api`: ceiling for the corretor's API keys. Effective key permissions =
-- api_keys.permissoes ∩ usuarios.permissoes_api, computed on every request.
ALTER TABLE usuarios
  ADD COLUMN perfil text NOT NULL DEFAULT 'corretor' CHECK (perfil IN ('admin', 'corretor')),
  ADD COLUMN telas text[] NOT NULL DEFAULT '{}'
    CONSTRAINT usuarios_telas_validas
    CHECK (telas <@ ARRAY['downloads', 'consultas', 'chaves']::text[]),
  ADD COLUMN permissoes_api text[] NOT NULL DEFAULT '{}'
    CONSTRAINT usuarios_permissoes_api_validas
    CHECK (permissoes_api <@ ARRAY['protocolos:listar', 'pdf:baixar', 'pdf:enviar']::text[]);

-- Existing users (only the owner) become admins.
UPDATE usuarios SET perfil = 'admin';

-- Every key belongs to one user; the API uses that user's portal credentials.
-- RESTRICT: users with keys are deactivated, not deleted (a deactivated user's keys are rejected).
ALTER TABLE api_keys
  ADD COLUMN usuario_id uuid NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT;
CREATE INDEX api_keys_usuario ON api_keys (usuario_id);

-- History ownership: copied from the key owner at request time, so the history stays filterable by
-- user even after the key is revoked. NULL in logs_erro when the error has no owner.
ALTER TABLE downloads_pdf
  ADD COLUMN usuario_id uuid REFERENCES usuarios (id) ON DELETE SET NULL;
CREATE INDEX downloads_pdf_usuario ON downloads_pdf (usuario_id, ocorrido_em DESC);

ALTER TABLE consultas_protocolos
  ADD COLUMN usuario_id uuid REFERENCES usuarios (id) ON DELETE SET NULL;
CREATE INDEX consultas_protocolos_usuario ON consultas_protocolos (usuario_id, ocorrido_em DESC);

ALTER TABLE logs_erro
  ADD COLUMN usuario_id uuid REFERENCES usuarios (id) ON DELETE SET NULL;
CREATE INDEX logs_erro_usuario ON logs_erro (usuario_id, ocorrido_em DESC);

-- Broker portal credentials, one row per user (optional for admins).
-- senha_cifrada = AES-256-GCM with CREDENCIAIS_CHAVE (same key in API and dashboard):
--   iv (12 bytes) || auth tag (16 bytes) || ciphertext; the user id is the additional authenticated
--   data, so a ciphertext copied to another user's row fails to decrypt.
-- The password is never returned by the dashboard. Saving a new one resets status to 'nao_testada'.
-- 'invalida' = the portal rejected the password; the API stops trying to log in until it is updated.
CREATE TABLE credenciais_portal (
  usuario_id          uuid PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,
  email_portal        text        NOT NULL,
  senha_cifrada       bytea       NOT NULL CHECK (octet_length(senha_cifrada) > 28),
  status              text        NOT NULL DEFAULT 'nao_testada'
                                  CHECK (status IN ('nao_testada', 'valida', 'invalida')),
  atualizada_em       timestamptz NOT NULL DEFAULT now(),
  atualizada_por      uuid        REFERENCES usuarios (id) ON DELETE SET NULL,
  ultimo_login_ok_em  timestamptz,
  invalidada_em       timestamptz
);

-- migrate:down

-- Structure only: the rows removed by the TRUNCATE above cannot be restored.
DROP TABLE credenciais_portal;
DROP INDEX logs_erro_usuario;
ALTER TABLE logs_erro DROP COLUMN usuario_id;
DROP INDEX consultas_protocolos_usuario;
ALTER TABLE consultas_protocolos DROP COLUMN usuario_id;
DROP INDEX downloads_pdf_usuario;
ALTER TABLE downloads_pdf DROP COLUMN usuario_id;
DROP INDEX api_keys_usuario;
ALTER TABLE api_keys DROP COLUMN usuario_id;
ALTER TABLE usuarios
  DROP COLUMN permissoes_api,
  DROP COLUMN telas,
  DROP COLUMN perfil;
