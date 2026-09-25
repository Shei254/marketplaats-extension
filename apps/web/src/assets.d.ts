/**
 * A file Vite copies into the build and hands back as its public URL. Declared for
 * the one kind imported that way — the Geist woff2 in `site-styles.ts` — rather
 * than by pulling in all of `vite/client`, which would also bring `import.meta.env`
 * types that nothing in this workspace reads.
 */
declare module "*.woff2?url" {
  const url: string;
  export default url;
}
