// Drives app/lib/schedule-commit-client.ts -- the module the builder now calls --
// against the local PostgreSQL carrying staging's real trigger bodies. The
// "client" is a thin shim that turns rpc(fn,args) into a real SQL call, so the
// code under test is the application's, not a reimplementation.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const PSQL = "/opt/homebrew/opt/postgresql@17/bin/psql";
const DSN = "postgresql://postgres@127.0.0.1:55432/atomic?sslmode=disable";
const UID = "11111111-1111-4111-8111-111111111111";

const q = async (sql, asRole = "authenticated") => {
  const pre = `set role ${asRole}; select set_config('request.jwt.claim.sub','${UID}',false);`;
  const { stdout } = await run(PSQL, ["-X", "-tA", "-d", DSN, "-c", pre + sql]);
  return stdout.trim().split("\n").filter(Boolean);
};
const raw = async (sql) => {
  try { return { out: (await run(PSQL, ["-X","-tA","-d",DSN,"-c",sql])).stdout.trim(), err: null }; }
  catch (e) { return { out: "", err: String(e.stderr || e.message) }; }
};

// The shim: same shape as supabase-js's rpc(), returning { data, error }.
const client = {
  async rpc(fn, args) {
    const lit = (v) => v === null || v === undefined ? "null"
      : typeof v === "number" ? String(v)
      : Array.isArray(v) ? (v.length === 0 ? "'{}'::uuid[]" : `array[${v.map(x=>`'${x}'`).join(",")}]::uuid[]`)
      : typeof v === "object" ? `'${JSON.stringify(v).replace(/'/g,"''")}'::jsonb`
      : `'${String(v).replace(/'/g,"''")}'`;
    // Named arguments, so the shim works for every function and cannot get an
    // order wrong. The earlier version hardcoded two signatures and silently
    // mis-called delete_lesson and delete_goal_pending_lessons.
    const order = Object.keys(args);
    const cast = (k, v) => k === "p_proposal_id" ? `'${v}'::uuid`
      : k === "p_placements" || k === "p_insert_rows" || k === "p_lesson_updates" ? `'${JSON.stringify(v)}'::jsonb`
      : lit(v);
    const sql = `select ${fn}(${order.map(k => `${k} => ${cast(k, args[k])}`).join(", ")});`;
    const pre = `set role authenticated; select set_config('request.jwt.claim.sub','${UID}',false);`;
    try {
      const { stdout } = await run(PSQL, ["-X","-tA","-d",DSN,"-c", pre + sql]);
      const last = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
      return { data: last.startsWith("{") ? JSON.parse(last) : last, error: null };
    } catch (e) {
      const t = String(e.stderr || "");
      if (process.env.SHIM_DEBUG) console.log('  [shim]', fn, '->', t.split('\n').filter(Boolean).slice(0,2).join(' | '));
      const m = /ERROR:\s*(.*)/.exec(t);
      const code = /permission denied|not found|not yours|outside|is not yours/.test(t) ? "42501"
        : /changed since|already consumed|expired|cascade|must not be deleted|planned to|continue from|would be deleted/.test(t) ? "40001"
        : /repeats an id|repeat a lesson_id|unknown key|same queue slot|limit 5000|at least 8 characters/.test(t) ? "22023"
        : /duplicate key value/.test(t) ? "23505"
        : "XX000";
      return { data: null, error: { message: m ? m[1] : t.slice(0,200), code } };
    }
  },
};
export { client, q, raw, UID };
