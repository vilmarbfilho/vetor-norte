-- migrate:up

-- Users created (or whose password was reset) by an admin in the dashboard get a generated temporary
-- password and must choose their own on the next login. The dashboard blocks everything else until then.
ALTER TABLE usuarios ADD COLUMN trocar_senha boolean NOT NULL DEFAULT false;

-- migrate:down

ALTER TABLE usuarios DROP COLUMN trocar_senha;
