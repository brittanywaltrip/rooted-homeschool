import { readFileSync } from 'node:fs'
import path from 'node:path'
// node build.mjs <repoDir> <outFile> <stagingEnvFile>
import { createRequire } from 'node:module'
// esbuild is not a project dependency: pass its install dir as ESBUILD_DIR.
const { build } = createRequire(path.join(process.env.ESBUILD_DIR ?? '.', 'x.js'))('esbuild')
const [repo, out, envFile] = process.argv.slice(2)
const env = readFileSync(envFile, 'utf8'); const g = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.replace(/^"|"$/g, '')
const version = JSON.parse(readFileSync(path.join(repo, 'node_modules/@supabase/auth-js/package.json'), 'utf8')).version
const here = path.dirname(new URL(import.meta.url).pathname)
await build({
  entryPoints: [path.join(here, 'entry.js')], bundle: true, format: 'iife', outfile: out, platform: 'browser', target: 'chrome120',
  nodePaths: [path.join(repo, 'node_modules')], logLevel: 'warning',
  define: { 'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(g('NEXT_PUBLIC_SUPABASE_URL')), 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(g('NEXT_PUBLIC_SUPABASE_ANON_KEY')), 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_POSTHOG_KEY': '""', '__AUTH_VERSION__': JSON.stringify(version) },
  plugins: [{ name: 'app-alias', setup(b) {
    b.onResolve({ filter: /^@sentry\/nextjs$/ }, () => ({ path: path.join(here, 'stubs/sentry.js') }))
    b.onResolve({ filter: /^@\/lib\/posthog$/ }, () => ({ path: path.join(here, 'stubs/posthog.js') }))
    b.onResolve({ filter: /^@\// }, a => b.resolve('./' + a.path.slice(2), { resolveDir: repo, kind: a.kind }))
  } }],
})
console.log(JSON.stringify({ out, authJs: version }))
