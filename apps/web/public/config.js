// What the deployment says about where things are, and on a development machine it says nothing.
//
// `index.html` loads this before the bundle, and the deployed image answers the same path from nginx with
// the two values its environment carries (apps/web/nginx.conf.template). An empty object is the healthy
// answer and means *the defaults in `src/admin/admin-config.ts` are correct*, which is the shape
// `GET /api/client-config` already serves the extension (ADR-0013).
//
// It is committed rather than generated because `vite dev` and `vite preview` serve this directory as-is,
// and a `<script>` tag whose file 404s is a console error on every page load of a site that is working.
window.__MPRELIST_WEB_CONFIG__ = {};
