# Everything the deployed stack reads out of a filesystem, shipped with the tag that names it
# (T81, docs/adr/0034-the-deployment-tree-ships-with-the-tag.md).
#
# **This is not a server and never runs.** `mprelist-deploy` does `docker create` on it and `docker cp` out
# of it; the container is removed without ever being started. Nothing in this image is executed on the host,
# which is what makes shipping the deploy machinery inside it safe to extract and never safe to install.
#
# **Why an image at all**, when ADR-0033 chose a bind mount out of the host's git checkout: that checkout was
# updated by hand, because putting a repository read key on the production machine is the second credential
# ADR-0023 refuses. Updating it by hand failed silently — a stale Caddyfile or an absent theme is not an
# error anywhere, it is a page that looks fine and is the wrong one. The registry is a channel the host
# already has a read-only token for, so this costs no credential and pins the files to the tag rather than to
# whenever somebody last pulled.
#
# The context is the repository root, because these two trees are in different places and one of them is
# deliberately outside `infra/` — which is the shape that caused the failure this image exists to end.
FROM scratch

# `infra/` entire, which is four of the five things the stack reads: the compose file `mprelist-deploy`
# runs, the Caddyfile that decides what the internet can reach, the production realm export Keycloak imports
# on first start, and the Postgres init scripts. `infra/deploy/` rides along so that a tag carries the
# scripts it expects; `mprelist-deploy` extracts them and *warns* rather than installing them, because bash
# reads a script incrementally and overwriting a running one executes whatever lands under the cursor.
COPY infra /tree/infra

# **Wholesale, and deliberately not a list of the four paths production actually mounts.** A list would also
# carry `infra/keycloak` and `infra/postgres/init` — the local stack's realm and init scripts — and leaving
# them out would be tidier. It would also be a second place to remember, and the bug this image exists to
# end is exactly "a file was added and nobody updated the thing that copies it". The dev realm's credentials
# are `admin`/`admin` and a published dev password, committed on purpose (infra/README.md), registered only
# against localhost redirect URIs, and already sat beside the production realm in the checkout this replaces
# — so nothing is newly exposed by them riding along, and `DeployedStackTest` is what stops the deployed
# stack pointing at them.

# And the login theme, which is the fifth and the one that is not under `infra/` at all. The compose files
# mount `../apps/keycloak-theme/theme`, a path relative to their own directory, so copying `infra/` alone —
# the obvious thing to do, and what was done — misses it entirely and silently.
#
# A pure `COPY` of files already in git, which is why this image needs no Node and no build stage: the theme
# is committed (ADR-0033), CI rebuilds it and fails on any difference, and this copies what that check just
# held to `brand.json`.
COPY apps/keycloak-theme/theme /tree/apps/keycloak-theme/theme

# **`docker create` refuses an image with no command at all** — "no command specified" — and this needs to
# be creatable, because that is how its filesystem is read. So it is given one, and it is deliberately a
# path that does not exist: `scratch` contains no shell, no libc and no executable of any kind, so there is
# nothing here that *could* be run even by somebody who tried. The container is created, copied out of, and
# removed.
CMD ["/this-image-is-a-filesystem-and-has-nothing-to-run"]
