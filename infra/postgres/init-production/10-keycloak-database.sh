#!/bin/sh
# Keycloak's own database, alongside the application's — infra/postgres/init/10-keycloak-database.sql with
# the one difference a deployment makes: the password is not written down here.
#
# A shell script rather than a `.sql` file because the image runs both and only this one can read the
# environment. `psql -v` and `:'…'` are what quote the value into the statement; an interpolated shell
# variable would be a password with an apostrophe in it breaking the deploy, or worse.
#
# The image runs this exactly once, on an empty data directory. Changing the password afterwards is an
# `ALTER ROLE`, not an edit to this file — see infra/README.md § Deploying.
set -eu

: "${MPRELIST_KEYCLOAK_DB_PASSWORD:?is what Keycloak signs into its own database with; set it in production.env}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
	-v password="$MPRELIST_KEYCLOAK_DB_PASSWORD" <<'SQL'
CREATE ROLE keycloak WITH LOGIN PASSWORD :'password';
CREATE DATABASE keycloak OWNER keycloak;
SQL
