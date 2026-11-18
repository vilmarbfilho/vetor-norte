-- migrate:up

-- Dashboard default language is English (chosen by the user). Existing users keep their current choice.
ALTER TABLE usuarios ALTER COLUMN idioma SET DEFAULT 'en';

-- migrate:down

ALTER TABLE usuarios ALTER COLUMN idioma SET DEFAULT 'pt';
