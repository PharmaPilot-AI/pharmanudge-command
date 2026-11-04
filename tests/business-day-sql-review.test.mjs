import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = (name) => readFileSync(new URL("../docs/drafts/" + name, import.meta.url), "utf8");
test("forward SQL is an atomic additive migration and never replaces an existing function", () => {
  const sql = read("LOCAL_ONLY_get_pharmacy_business_day_status.sql").replace(/--[^\n]*/g, "");
  assert.match(sql, /\bbegin\s*;/i);
  assert.match(sql, /\bcommit\s*;/i);
  assert.match(sql, /create\s+function\s+public\.get_pharmacy_business_day_status/i);
  assert.doesNotMatch(sql, /create\s+or\s+replace/i);
});
test("review and rollback pin the exact forward body and do not touch ledger or broad privileges", () => {
  const source = read("LOCAL_ONLY_get_pharmacy_business_day_status.sql").match(
    /as \$\$(.*?)\$\$/s,
  )[1];
  for (const name of ["business-day-status-VERIFY.sql", "business-day-status-ROLLBACK.sql"]) {
    const s = read(name);
    assert.equal(s.match(/\$expected_source\$(.*?)\$expected_source\$/s)[1], source);
    assert.doesNotMatch(
      s,
      /\b(?:update|insert\s+into|delete\s+from|alter\s+table|grant\s+.*on\s+all)\b/i,
    );
  }
  assert.match(read("business-day-status-VERIFY.sql"), /begin transaction read only/i);
  assert.match(
    read("business-day-status-ROLLBACK.sql"),
    /drop function public\.get_pharmacy_business_day_status\(uuid\) restrict/i,
  );
});
