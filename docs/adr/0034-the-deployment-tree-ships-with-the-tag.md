# ADR-0034: The deployment tree ships with the tag, and the host stops being a checkout

**Status:** Accepted (2026-09-19)
**Scope:** [`infra/deploy/Dockerfile`](../../infra/deploy/Dockerfile) and
[`infra/deploy/mprelist-deploy`](../../infra/deploy/mprelist-deploy), the third package in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) and
[`.github/workflows/prune-ghcr.yml`](../../.github/workflows/prune-ghcr.yml), and the host layout
[`infra/README.md`](../../infra/README.md) describes.
**Amends [ADR-0033](0033-the-login-page-is-ours-and-is-generated.md)** in its second half only — *how* the
generated theme reaches a server. Its first half, that the sign-in page is a surface of ours and is
generated, is untouched and is the reason this exists at all.
**Amends [ADR-0023](0023-ci-builds-the-images-and-the-host-pulls.md)**, which put a registry in the deploy
path and left the host's checkout to be updated by hand. T81 is the work.

**The decision is that everything the deployed stack reads out of a filesystem travels as image content**,
pulled with the read-only token the host already holds; that the host is therefore **a directory and not a
git checkout**; and that a deploy **says so when the realm is not asking for the theme**, because that is the
one part of this no file delivery can fix.

## Context

ADR-0033 chose to commit the generated theme and bind-mount it out of the checkout the host already had. The
reasoning was sound and the cost was named in the same breath — the compose file says it, and so does
`mprelist-deploy`:

> **It is therefore subject to the `git pull` rule**: a release that changes the theme and is deployed
> without one goes on serving the old page, with no error anywhere.

That cost came due on the first release after T80. The operator copied `infra/` to the host, which is the
obvious thing to do and is wrong in a way nothing reports: of the five paths the production stack mounts,
four are under `infra/` and the fifth is `../apps/keycloak-theme/theme`, **relative to the compose file's own
directory and therefore outside the folder being copied**. Docker does not treat a missing bind-mount source
as an error; it creates an empty directory. Keycloak does not treat an empty theme directory as an error; it
serves its built-in pages. The result is a sign-in page that looks deliberate and is a different product's.

Three things make this worse than one missed directory:

- **It is the whole class, not the theme.** The Caddyfile decides what the internet can reach, the realm
  export is imported once and is the file whose mistakes are "the most expensive and the least visible"
  (`InfraFiles`), and the compose file is what `mprelist-deploy` runs. Every one of them goes stale the same
  silent way. The theme is merely the one that changes often enough to have been noticed first.
- **The pull is invisible when it is skipped.** There is no state anywhere that says "these files are older
  than the images running beside them". `MPRELIST_IMAGE_TAG` records what was deployed; nothing records what
  the tree is.
- **Even a correct delivery would not have fixed it.** `loginTheme` is a realm *property*, and a realm is
  imported on first start and never again while its database exists. A realm that came up before T80 does not
  ask for the theme however correctly the files arrive.

## Options weighed

### How the tree reaches the host

**1. A read-only deploy key and `git pull` in the deploy script.** The conventional answer, about ten lines.
Its usual objection — "a second credential" — deserves less weight than ADR-0023 gives it: the honest blast
radius of a leaked *read-only* deploy key is that somebody reads this repository, since `production.env` is
never committed and `.env` holds only the well-known development passwords. The real objection is different
and is ADR-0023's own: *"what is running right now has an immutable answer even if somebody later moves a
tag."* A `git pull` leaves the tree at whatever `origin/master` pointed to that second, so the files stop
being pinned to the tag whose images they run beside — and a merge landing between the tag and the deploy
would mount one commit's files against another commit's binaries, silently.

**2. CI pushes a tarball over the SSH channel it already has.** No new credential and no new package. But the
forced command exists precisely so that a stolen key cannot write arbitrary files; accepting a tarball turns
ADR-0023's "it can deploy an image" into "it can write files as the deploy user", which is most of a shell.
Rejected on the security model rather than on cost.

**3. A third `…/keycloak` image** — ADR-0033's option 5, reconsidered. Now the wrong *shape* rather than the
wrong price: it carries the theme natively and carries none of the other four paths, so it would have to
exist beside a second mechanism for them. It also writes Keycloak's version in a second file and costs
`DeployedStackTest` its claim that the deployed Keycloak is the stock one the suite ran against.

**4. Ride the existing `web` image.** No new package, no prune or retag edits. Puts the realm export and the
Caddyfile inside the internet-facing image for no reason, and makes a Caddyfile fix a redeploy of the web
application.

**5. A package of its own, `FROM scratch`.** What was chosen. ~65 KB, built from files already in git,
pulled with the existing token, and extracted by `docker create` + `docker cp` + `docker rm` — the container
is never started. The costs ADR-0033 counted against options 5 and 7 turned out to be three edits: one word
in the release job's `for image in api web deploy` loop, one item in prune's package list, and a build and a
push line.

### What happens to the scripts that travel in it

`infra/deploy/` rides along, so a tag carries the deploy machinery it expects. **They are extracted and never
installed.** Bash reads a script incrementally, so overwriting `/usr/local/bin/mprelist-deploy` while it is
the process running executes whatever lands under the read cursor — a failure that would arrive on some
future release, on the deploy that changed that file, with nothing legible in the log. Self-installing at the
very end would avoid that and would need the deploy user to own `/usr/local/bin`, widening what a stolen key
reaches. So the difference is printed and installing is a decision somebody makes.

## Decision

`ghcr.io/<owner>/<repo>/deploy` carries `infra/` and `apps/keycloak-theme/theme/`, is built and pushed beside
the two server images, is retagged by the same release loop and pruned by the same rules.

`mprelist-deploy <tag>` fetches it before the dump — it migrates nothing, and it is how a tag predating this
fails cheaply rather than after a `pg_dump`. The tree lands in a staging directory on the same filesystem, is
checked for the paths this deploy is about to rely on, and only then replaces them. **Staged and swapped, not
copied over the top:** `docker cp` merges, so a file deleted upstream would survive on the host for ever, and
the first symptom of that is a Caddyfile route nobody can account for.

`production.env` sits beside the managed trees and in neither of them. It holds every password the deployment
has, this host is the only copy, and no image has any business carrying it.

**The host is no longer a git checkout and needs no git.** Bootstrap is a directory, `production.env`, two
installed scripts, and `mprelist-deploy <tag>`.

**The deploy checks the page rather than the file.** After `up -d --wait` it fetches the login page and looks
for `login-shell`, which our `template.ftl` draws and Keycloak's own theme never does. No credential is
needed for that, which is the point: the alternative was reconciling realm settings over the admin API with
the bootstrap account `production.env.example` tells you to stop using. It **warns rather than failing** — the
stack is up, healthy and serving, so the deploy did work, and a non-zero exit would invite a re-run that
changes nothing.

## Consequences

- **The registry holds three packages**, and `prune-ghcr` reaps the third on the same rules. It is kilobytes
  rather than hundreds of megabytes, but an unpruned package still accretes a version per green `master`, and
  a release whose images were kept while its tree was reaped would be a tag that cannot be redeployed.
- **A tag built before this cannot be deployed by the new script**, because it has no `deploy` package. The
  script says exactly that rather than failing on a missing file later.
- **The theme stays committed**, on a justification this changes. `brand.json`, the glossary and
  `infra/README.md` said it was committed "because a deployed Keycloak reads it out of the host's checkout",
  and there is no longer such a checkout. It stays because the *local* stack bind-mounts it straight out of
  the working tree, so it must exist without anyone running a build, and because the deploy image is then a
  pure `COPY` of committed files needing no Node in that job. CI's drift gate is unchanged and still what
  makes the committed copy a cache of `brand.json` rather than a second copy of it.
- **`DeployedStackTest` keeps both properties it had.** No Keycloak image of ours exists, so the deployed
  server is still the tag the suite ran against; and the production compose still builds nothing, because the
  extraction is the script's and not compose's.
- **A realm property still cannot be deployed.** The check makes that loud on every deploy instead of on the
  day somebody looks at the sign-in page. Setting it remains a console step, and `infra/README.md` says which.
