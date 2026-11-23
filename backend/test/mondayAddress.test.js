// Monday's API address is a setting: MONDAY_API_URL, whose default is today's address, so nothing changes until the
// day Monday is left. Reads source only (requiring src/monday.js would open the Redis queue): the line that sets the
// address is run as written, once with the variable unset and once set.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const src = readFileSync(join(__dirname, "..", "src", "monday.js"), "utf8");
const line = (src.match(/^const API_URL = .*$/m) || [])[0];
const apiUrlWith = (env) => vm.runInNewContext(line.replace(/^const /, "") + "; API_URL", { process: { env } });

test("Monday address unset: today's address; MONDAY_API_URL is read", () => {
  assert.ok(line, "monday.js sets API_URL in one line");
  assert.equal(apiUrlWith({}), "https://api.monday.com/v2");
  assert.equal(apiUrlWith({ MONDAY_API_URL: "https://friday.invalid/v2" }), "https://friday.invalid/v2");
});

test("mondayQuery posts to that address", () => {
  assert.match(src, /await fetch\(API_URL, \{/);
});
