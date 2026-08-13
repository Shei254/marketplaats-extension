-- Keycloak's own database, alongside the application's.
--
-- Two databases in one instance, not two instances: Keycloak manages its schema itself, and
-- Flyway (#17) owns `mprelist`. Sharing one database would put two schema managers in it.
--
-- The Postgres image runs this exactly once, when it initialises an empty data directory. Editing
-- it later changes nothing until the volume is dropped — see infra/README.md § Resetting.
--
-- The role and password are also spelled out as KC_DB_USERNAME / KC_DB_PASSWORD in
-- docker-compose.yml; change one and Keycloak fails to start against an authentication error.

CREATE ROLE keycloak WITH LOGIN PASSWORD 'keycloak';
CREATE DATABASE keycloak OWNER keycloak;
