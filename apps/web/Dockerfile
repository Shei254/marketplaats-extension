# syntax=docker/dockerfile:1
#
# The site as one image (T55, #86): the bundle built by node, served by nginx.
#
# **The build context is the repository root**, unlike `apps/api`'s, and it has to be: this workspace depends
# on `@mprelist/ui` and `@mprelist/contracts` as sources rather than as published packages, and `brand.json`
# — which `vite.config.ts` resolves the `{{brand.name}}` tokens in `index.html` from — is above every
# workspace. `.dockerignore` at the root is what keeps that from meaning "the whole working tree".
#
# See infra/docker-compose.prod.yml for how it is run.

FROM node:24-alpine AS build
WORKDIR /repo

# Every workspace's manifest before any source, so that `npm ci` is re-run when a dependency changes and not
# when a component does. `npm ci` needs all of them named in the lock file present, including the ones this
# image never builds.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/extension/package.json apps/extension/
COPY packages/ui/package.json packages/ui/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci

COPY brand.json ./
COPY packages packages
COPY apps/web apps/web
RUN npm run build -w @mprelist/web

FROM nginx:alpine

COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

# Only our own two tokens are substituted into that template. Without this filter the image substitutes
# every name in the environment, and `$uri` in a `try_files` is one typo away from being one of them.
ENV NGINX_ENVSUBST_FILTER=^MPRELIST_WEB_
# Declared empty rather than left unset, because envsubst leaves an *undefined* name standing as literal
# `${MPRELIST_WEB_ISSUER}` — which nginx then reads as a variable of its own and refuses to start on. Empty
# is what the bundle reads as "the defaults are correct" (`deployed-config.ts`), so a bare `docker run` of
# this image serves the site configured exactly as it was built.
ENV MPRELIST_WEB_ISSUER=""
ENV MPRELIST_WEB_API_BASE_URL=""

EXPOSE 80
