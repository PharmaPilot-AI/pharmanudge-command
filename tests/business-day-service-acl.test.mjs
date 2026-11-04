import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = (name) => readFileSync(new URL("../docs/drafts/" + name, import.meta.url), "utf8");
test("forward explicitly revokes service_role only on the new UUID function before the strict ACL guard", () => {
  const s = read("LOCAL_ONLY_get_pharmacy_business_day_status.sql").replace(/--[^\n]*/g, "");
  const revoke =
    /revoke\s+execute\s+on\s+function\s+public\.get_pharmacy_business_day_status\(uuid\)\s+from\s+service_role\s*;/i;
  assert.match(s, revoke);
  assert.ok(s.search(revoke) < s.indexOf("do $acl_guard$"));
  assert.match(s, /count\(\*\).*aclexplode\(v_function\.proacl\)\) <> 2/s);
  assert.doesNotMatch(
    s,
    /alter\s+default\s+privileges|on\s+all\s+functions|revoke\s+[^;]*on\s+(?:table|schema)/i,
  );
});
test("verification and rollback retain the same exact body pin despite function-specific ACL revision", () => {
  const body = read("LOCAL_ONLY_get_pharmacy_business_day_status.sql").match(
    /as \$\$(.*?)\$\$/s,
  )[1];
  for (const name of ["business-day-status-VERIFY.sql", "business-day-status-ROLLBACK.sql"]) {
    const s = read(name);
    assert.equal(s.match(/\$expected_source\$(.*?)\$expected_source\$/s)[1], body);
    assert.match(s, /count\(\*\).*aclexplode\(v_function\.proacl\)\) <> 2/s);
  }
});

test("target preflight is catalog-only read-only and covers owner/default layers/overloads/role paths", () => {
  const s = read("business-day-status-PREFLIGHT.sql").replace(/--[^\n]*/g, "");
  assert.match(s, /begin transaction read only/i);
  assert.match(s, /rollback;/i);
  assert.match(s, /cardinality\(l\.acl\)=0/);
  assert.match(s, /session_user/);
  assert.match(s, /defaclnamespace=0/);
  assert.match(s, /public-schema-additions/);
  assert.match(s, /p\.proname='get_pharmacy_business_day_status'/);
  assert.match(s, /pg_has_role\([^;]*'SET'/s);
  assert.doesNotMatch(
    s,
    /\b(?:create|alter|drop|insert|update|delete|grant|revoke|call)\s+(?:function|table|role|schema|default|into|from|on)/i,
  );
  assert.doesNotMatch(s, /select\s+public\.get_pharmacy_business_day_status\(/i);
});

test("preflight surfaces SET-to-bridge followed by inherited privileged-role access", () => {
  const s = read("business-day-status-PREFLIGHT.sql").replace(/--[^\n]*/g, "");
  assert.match(s, /reachable_set_role/);
  assert.match(s, /pg_has_role\(c\.oid,b\.oid,'SET'\)/);
  assert.match(s, /pg_has_role\(b\.oid,a\.oid,'USAGE'\)/);
  assert.match(s, /pg_has_role\(b\.oid,o\.oid,'USAGE'\)/);
});
