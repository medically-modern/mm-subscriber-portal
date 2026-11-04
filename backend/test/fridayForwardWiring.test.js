// The Friday forward is wired, not just written. Every Monday board write this service makes goes through
// mondayQuery (src/monday.js; the BullMQ write worker in src/queue.js calls the same function), and it hands
// Friday what Monday accepted only after Monday's answer has been read for errors, so a refused write never
// reaches Friday and Monday's answer comes back unchanged. A Monday write added anywhere else is a write Friday
// never hears: this file fails. Reads source only: no Redis, Monday or network.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const SRC = join(__dirname, "..", "src");
const read = (f) => readFileSync(join(SRC, f), "utf8");
const between = (s, from, to) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));

test("mondayQuery forwards after every error check and before it returns Monday's answer", () => {
  const src = read("monday.js");
  assert.match(src, /const fridayForward = createFridayForward\(\{ env: process\.env, log: console\.log, service: "mm-subscriber-portal" \}\);/);
  const q = between(src, "async function mondayQuery(", "// ─── Find patient by phone");
  const hook = q.indexOf("fridayForward.onMutation({ query, variables, data: data.data })");
  assert.ok(hook > -1, "mondayQuery hands the mutation to Friday");
  assert.ok(hook > q.lastIndexOf("throw new Error("), "only after Monday's errors have been read");
  assert.ok(hook < q.lastIndexOf("return data.data;"), "and before the answer is returned");
});

test("no other Monday write path exists in src", () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith(".js"));
  const mondayCallers = files.filter((f) => /api\.monday\.com/.test(read(f)));
  assert.deepEqual(mondayCallers, ["monday.js"]);
  assert.equal((read("monday.js").match(/await fetch\(/g) || []).length, 1, "mondayQuery is monday.js's only call");
  assert.match(read("queue.js"), /await mondayQuery\(query, variables\)/, "the write worker goes through mondayQuery");
});

test("/health says whether the forward is on and what it has done", () => {
  assert.match(read("index.js"), /friday: require\("\.\/monday"\)\.fridayForward\.status\(\)/);
});
