import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const router = require("@tanstack/react-router");

function compile(name, imports) {
  const source = readFileSync(new URL(`../src/routes/${name}.tsx`, import.meta.url), "utf8");
  const module = { exports: {} };
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (id) => {
      if (id in imports) return imports[id];
      if (id === "react/jsx-runtime" || id === "zod") return require(id);
      if (id.startsWith("@/components/")) return new Proxy({}, { get: (_, key) => key });
      throw new Error(`Unapproved fixture dependency: ${id}`);
    },
    window: {
      location: {
        assign() {
          throw new Error("Unexpected document navigation");
        },
      },
    },
    console,
    Error,
  });
  return module.exports.Route;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function nodes(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return [value, ...nodes(value.props?.children)];
}
// Execute the actual redirect allowlist and role defaults, not a parallel policy.
const modeSource = readFileSync(new URL("../src/lib/app-mode.tsx", import.meta.url), "utf8");
const modeAst = ts.createSourceFile(
  "app-mode.tsx",
  modeSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let defaultsExpression;
for (const statement of modeAst.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  const declaration = statement.declarationList.declarations.find(
    (d) => d.name.getText(modeAst) === "roleDefaults",
  );
  if (declaration) defaultsExpression = declaration.initializer.getText(modeAst);
}
assert.ok(defaultsExpression);
const roleDefaults = runInNewContext(`(${defaultsExpression})`);
const roleHomes = Object.fromEntries(
  Object.entries(roleDefaults).map(([role, value]) => [role, value.home]),
);
const redirectModule = { exports: {} };
runInNewContext(
  ts.transpileModule(
    readFileSync(new URL("../src/lib/auth/redirect.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  {
    module: redirectModule,
    exports: redirectModule.exports,
    require: (id) => {
      assert.equal(id, "../app-mode");
      return { roleDefaults };
    },
  },
);
const redirects = redirectModule.exports;
function loginFixture() {
  let route,
    cursor = 0,
    cells = [],
    context = { user: null, pharmacyContext: null },
    calls = 0,
    refreshes = 0;
  const loginGate = deferred(),
    refreshGate = deferred(),
    errors = [],
    navigations = [];
  const hooks = {
    ...React,
    useState(initial) {
      const i = cursor++;
      if (!(i in cells)) cells[i] = initial;
      return [
        cells[i],
        (v) => {
          cells[i] = v;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      return (cells[i] ??= { current: initial });
    },
  };
  route = compile("login", {
    react: hooks,
    "@tanstack/react-router": {
      createFileRoute: () => (options) => ({
        options,
        useSearch: () => ({ redirect: undefined }),
        useRouteContext: () => context,
      }),
      Link: "Link",
      redirect: router.redirect,
      useNavigate: () => async (x) => {
        navigations.push(x);
      },
      useRouter: () => ({
        invalidate: async (options) => {
          assert.equal(options?.sync, true, "wait for the complete invalidation transition");
          refreshes++;
          await refreshGate.promise;
        },
      }),
    },
    "@tanstack/react-start": { useServerFn: (x) => x },
    "@hookform/resolvers/zod": { zodResolver: () => undefined },
    "react-hook-form": { useForm: () => ({ handleSubmit: (x) => x, control: {} }) },
    "lucide-react": { KeyRound: "Icon", ShieldOff: "Icon" },
    sonner: { toast: { error: (x) => errors.push(x) } },
    "@/lib/auth/actions": {
      loginAction: async () => {
        calls++;
        await loginGate.promise;
      },
    },
    "@/lib/auth/redirect": redirects,
  });
  function render() {
    cursor = 0;
    return route.options.component();
  }
  function submit() {
    return nodes(render())
      .find((x) => x.type === "CredentialForm")
      .props.onSubmit({ email: "fixture@example.invalid", password: "synthetic" });
  }
  return {
    route,
    loginGate,
    refreshGate,
    errors,
    navigations,
    render,
    submit,
    get calls() {
      return calls;
    },
    get refreshes() {
      return refreshes;
    },
    setContext(x) {
      context = x;
    },
  };
}

test("login waits for refreshed session context, not a guessed owner-home navigation", async () => {
  const f = loginFixture(),
    pending = f.submit();
  f.loginGate.resolve();
  await new Promise(setImmediate);
  assert.equal(
    f.refreshes,
    1,
    "successful cookie write must refresh the current login route before choosing a role destination",
  );
  assert.deepEqual(f.navigations, [], "must not navigate with the pre-login role");
  assert.equal(nodes(f.render()).find((x) => x.type === "Button").props.disabled, true);
  f.refreshGate.resolve();
  await pending;
  assert.equal(
    nodes(f.render()).find((x) => x.type === "Button").props.disabled,
    true,
    "successful transition must not unlock the old form before unmount",
  );
});

test("duplicate calls are ignored while login is unresolved", async () => {
  const f = loginFixture(),
    a = f.submit(),
    b = f.submit();
  assert.equal(f.calls, 1);
  f.loginGate.resolve();
  f.refreshGate.resolve();
  await Promise.all([a, b]);
});

test("wrong-password failure unlocks the form and retains a useful error", async () => {
  const f = loginFixture(),
    a = f.submit();
  f.loginGate.reject(new Error("Invalid email or password."));
  await a;
  assert.equal(nodes(f.render()).find((x) => x.type === "Button").props.disabled, false);
  assert.deepEqual(f.errors, ["Invalid email or password."]);
});

test("root layout follows the rendered match while location already targets authenticated Home", () => {
  let selected;
  const route = compile("__root", {
    react: React,
    "@tanstack/react-query": { QueryClientProvider: "QueryClientProvider" },
    "@tanstack/react-router": {
      Outlet: "Outlet",
      Link: "Link",
      createRootRouteWithContext: () => (options) => ({
        options,
        useRouteContext: () => ({ queryClient: {} }),
      }),
      useRouterState: ({ select }) => {
        const value = select({
          location: { pathname: "/" },
          resolvedLocation: { pathname: "/login" },
          matches: [
            { routeId: "__root__", pathname: "/" },
            { routeId: "/login", pathname: "/login" },
          ],
        });
        if (typeof value === "string") selected = value;
        return value;
      },
    },
    "@tanstack/react-start": { createServerFn: () => ({ handler: (x) => x }) },
    "../styles.css?url": {},
    "../lib/lovable-error-reporting": {},
    "@/lib/app-mode": { AppModeProvider: "AppModeProvider" },
    "@/lib/auth/context": {},
    "@/lib/auth/redirect": {},
    "@/lib/pharmacy-context": {},
    "@/lib/supabase/server": {},
  });
  const tree = route.options.component();
  assert.equal(
    selected,
    "/login",
    "layout must use the same committed match as Outlet, not the incoming URL",
  );
  assert.equal(
    nodes(tree).some((x) => x.type === "AppShell"),
    false,
    "pending Home must never wrap the retained login outlet",
  );
});

test("slow destination pending commit keeps a public Logging in state instead of an empty dashboard", () => {
  let selected;
  const route = compile("__root", {
    react: React,
    "@tanstack/react-query": { QueryClientProvider: "QueryClientProvider" },
    "@tanstack/react-router": {
      Outlet: "Outlet",
      Link: "Link",
      createRootRouteWithContext: () => (options) => ({
        options,
        useRouteContext: () => ({ queryClient: {} }),
      }),
      useRouterState: ({ select }) => {
        const value = select({
          status: "pending",
          location: { pathname: "/pos" },
          resolvedLocation: { pathname: "/login" },
          matches: [
            { routeId: "__root__", pathname: "/" },
            { routeId: "/pos", pathname: "/pos", status: "pending" },
          ],
        });
        if (typeof value === "string") selected = value;
        return value;
      },
    },
    "@tanstack/react-start": { createServerFn: () => ({ handler: (x) => x }) },
    "../styles.css?url": {},
    "../lib/lovable-error-reporting": {},
    "@/lib/app-mode": { AppModeProvider: "AppModeProvider" },
    "@/lib/auth/context": {},
    "@/lib/auth/redirect": {},
    "@/lib/pharmacy-context": {},
    "@/lib/supabase/server": {},
  });
  const tree = route.options.component();
  assert.equal(
    nodes(tree).some((x) => x.type === "AppShell"),
    false,
  );
  assert.equal(
    nodes(tree).some((x) => x.props?.role === "status" && x.props.children === "Logging in…"),
    true,
  );
});

for (const role of ["owner", "cashier"]) {
  test(`refreshed ${role} route admission selects the existing role home`, () => {
    const f = loginFixture();
    assert.throws(
      () =>
        f.route.options.beforeLoad({
          context: { user: { userId: "synthetic" }, pharmacyContext: { role } },
          search: {},
        }),
      (e) => e.options.to === roleHomes[role],
    );
  });
}

// A dedicated child uses the package's development export so its isServer
// option is honored; Node's default export otherwise forces server loading.
test("real client memory-router reproduces incoming URL / committed login divergence", async () => {
  const { spawnSync } = await import("node:child_process");
  const probe = `
    global.self = globalThis;
    const {createRouter,createRootRoute,createRoute,createMemoryHistory}=require('@tanstack/react-router');
    let release,entered;
    const gate=new Promise(r=>release=r),entry=new Promise(r=>entered=r);
    const root=createRootRoute();
    const login=createRoute({getParentRoute:()=>root,path:'/login'});
    const home=createRoute({getParentRoute:()=>root,path:'/',loader:async()=>{entered();await gate;}});
    const instance=createRouter({origin:'http://127.0.0.1',routeTree:root.addChildren([login,home]),history:createMemoryHistory({initialEntries:['/login']}),isServer:false,defaultPendingMs:10000});
    (async()=>{await instance.load();instance.history.push('/');const next=instance.load();await entry;
      console.log(JSON.stringify({location:instance.state.location.pathname,match:instance.state.matches.at(-1).pathname}));
      release();await next;
    })().catch(()=>{process.exitCode=1;});
  `;
  const result = spawnSync(process.execPath, ["--conditions=development", "-e", probe], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { location: "/", match: "/login" });
});

for (const [name, search, context, target] of [
  [
    "owner authorised return",
    { redirect: "/inventory" },
    { user: {}, pharmacyContext: { role: "owner" } },
    "/inventory",
  ],
  [
    "external return rejected",
    { redirect: "https://evil.invalid/" },
    { user: {}, pharmacyContext: { role: "cashier" } },
    "/pos",
  ],
  [
    "invitation precedes return and requires no existing membership",
    { invitation: "00000000-0000-4000-8000-000000000001", redirect: "/inventory" },
    { user: {}, pharmacyContext: null },
    "/accept-invitation",
  ],
]) {
  test(name, () => {
    const f = loginFixture();
    assert.throws(
      () => f.route.options.beforeLoad({ context, search }),
      (e) =>
        e.options.to === target &&
        (!search.invitation || e.options.search.invitation === search.invitation),
    );
  });
}
test("authenticated account without membership remains on the public no-membership view", () => {
  const f = loginFixture(),
    context = { user: { userId: "fixture" }, pharmacyContext: null };
  assert.doesNotThrow(() => f.route.options.beforeLoad({ context, search: {} }));
  f.setContext(context);
  assert.equal(
    nodes(f.render()).find((x) => x.type === "EmptyState").props.title,
    "No pharmacy membership",
  );
});

for (const role of ["owner", "cashier"]) {
  test(`real invalidation refreshes ${role} context and waits through redirected destination loader`, async () => {
    const { spawnSync } = await import("node:child_process");
    const probe = `
      global.self = globalThis;
      const assert=require('node:assert/strict'), {readFileSync}=require('node:fs'), {runInNewContext}=require('node:vm');
      const ts=require('typescript'), React=require('react'), router=require('@tanstack/react-router');
      const compile=${compile.toString()};
      const role=${JSON.stringify(role)}, roleDefaults=${JSON.stringify(roleDefaults)};
      const helper={exports:{}};
      runInNewContext(ts.transpileModule(readFileSync('src/lib/auth/redirect.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:helper,exports:helper.exports,require:()=>({roleDefaults})});
      let authenticated=false,rootCalls=0,releaseAuth,enteredAuth,releaseDestination,enteredDestination,settled=false;
      const authGate=new Promise(r=>releaseAuth=r),authEntered=new Promise(r=>enteredAuth=r);
      const destinationGate=new Promise(r=>releaseDestination=r),destinationEntered=new Promise(r=>enteredDestination=r);
      // compile uses new URL relative to this test module, supplied as source below.
      const root=compile('__root',{
        react:React,'@tanstack/react-query':{QueryClientProvider:'Provider'},
        '@tanstack/react-router':router,'@tanstack/react-start':{createServerFn:()=>({handler:fn=>fn})},
        '../styles.css?url':{},'../lib/lovable-error-reporting':{},'@/lib/app-mode':{},
        '@/lib/auth/context':{resolveSessionUser:async()=>{rootCalls++;if(!authenticated)return null;enteredAuth();await authGate;return {userId:'fixture',email:'fixture@example.invalid',accessToken:'synthetic'};}},
        '@/lib/auth/redirect':helper.exports,'@/lib/pharmacy-context':{getPharmacyContext:async()=>({role,pharmacyId:'fixture',userId:'fixture'})},'@/lib/supabase/server':{createServerSupabaseClient:()=>({})}
      });
      const login=compile('login',{
        react:React,'@tanstack/react-router':{...router,createFileRoute:()=>options=>router.createRoute({...options,path:'/login',getParentRoute:()=>root})},
        '@tanstack/react-start':{useServerFn:fn=>fn},'@hookform/resolvers/zod':{zodResolver:()=>{}},'lucide-react':{},'react-hook-form':{},sonner:{},'@/lib/auth/actions':{},'@/lib/auth/redirect':helper.exports
      });
      const target=roleDefaults[role].home;
      const destination=router.createRoute({getParentRoute:()=>root,path:target,loader:async()=>{enteredDestination();await destinationGate;}});
      const instance=router.createRouter({origin:'http://127.0.0.1',routeTree:root.addChildren([login,destination]),history:router.createMemoryHistory({initialEntries:['/login']}),isServer:false,context:{queryClient:{}},defaultPendingMs:10000});
      (async()=>{
        await instance.load();assert.equal(rootCalls,1);
        const stop=instance.history.subscribe(()=>{void instance.load();});
        authenticated=true;
        const pending=instance.invalidate({sync:true}).then(()=>{settled=true;});
        await authEntered;assert.equal(settled,false);releaseAuth();
        await destinationEntered;await new Promise(setImmediate);assert.equal(settled,false,'invalidate resolved before redirected destination loader');
        releaseDestination();await pending;
        assert.equal(instance.state.matches.at(-1).pathname,target);
        assert.equal(instance.state.matches.at(-1).context.pharmacyContext.role,role);
        stop();console.log(JSON.stringify({role,target,freshContext:true,destinationSettled:true}));
      })().catch(e=>{console.error(e.message);process.exitCode=1;});
    `;
    // The compiled helper's import.meta URL is fixed to the actual test source;
    // child executes the same source callbacks, not a parallel route policy.
    const childSource = probe.replace(
      "new URL(`../src/routes/${name}.tsx`, import.meta.url)",
      'new URL(`src/routes/${name}.tsx`, "file://" + process.cwd() + "/")',
    );
    const result = spawnSync(process.execPath, ["--conditions=development", "-e", childSource], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      role,
      target: roleHomes[role],
      freshContext: true,
      destinationSettled: true,
    });
  });
}
