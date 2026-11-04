-- READ-ONLY TARGET PREFLIGHT — review query, NOT permission to connect or deploy.
-- PostgreSQL 17 / Supabase-style catalog. Run only in an explicitly approved target.
-- Intended migration/function owner below is postgres. Change every VALUES owner
-- literal coherently if a different trusted role will actually execute the forward.
-- The effective function owner will be the role executing CREATE FUNCTION, not
-- necessarily session_user. Do not assume a role is trusted because it is named postgres.
-- Output is for private review; it makes no application calls or data reads.
begin transaction read only;
set local statement_timeout = '15s';
set local lock_timeout = '3s';
set local search_path = pg_catalog, pg_temp;

-- Connection identity and intended owner: role attributes and schema CREATE rights.
with intended(role_name) as (values ('postgres'::name))
select current_database() as database_name, current_user as effective_connection_role,
       session_user as session_role, current_setting('server_version') as server_version,
       i.role_name as intended_function_owner, r.oid is not null as intended_role_exists,
       r.rolsuper, r.rolcanlogin, r.rolinherit, r.rolbypassrls, r.rolcreaterole,
       n.nspowner::regrole as public_schema_owner, n.nspacl as public_schema_acl,
       has_schema_privilege(r.oid, n.oid, 'CREATE') as intended_owner_can_create_in_public
from intended i
left join pg_roles r on r.rolname=i.role_name
left join pg_namespace n on n.nspname='public';

-- Exact required API-role attributes. Missing roles are explicitly visible.
with wanted(role_name) as (values ('anon'::name),('authenticated'::name),('service_role'::name))
select w.role_name, r.oid is not null as role_exists, r.rolsuper, r.rolinherit,
       r.rolcanlogin, r.rolbypassrls, r.rolcreaterole
from wanted w left join pg_roles r on r.rolname=w.role_name
order by w.role_name;

-- Function defaults have TWO layers: global defaults (or built-in fallback),
-- plus additive public-schema defaults. Inspect both; do not edit either.
with intended(role_name) as (values ('postgres'::name)),
owner_role as (select r.oid from pg_roles r join intended i on r.rolname=i.role_name),
acl_layers as (
 select 'global-or-built-in'::text as layer, o.oid as intended_owner,
        coalesce(d.defaclacl, acldefault('f',o.oid)) as acl
 from owner_role o left join pg_default_acl d
   on d.defaclrole=o.oid and d.defaclobjtype='f' and d.defaclnamespace=0
 union all
 select 'public-schema-additions', o.oid, coalesce(d.defaclacl,'{}'::aclitem[])
 from owner_role o
 join pg_namespace n on n.nspname='public'
 left join pg_default_acl d
   on d.defaclrole=o.oid and d.defaclobjtype='f' and d.defaclnamespace=n.oid
)
select l.layer, l.intended_owner::regrole as intended_owner, l.acl as complete_layer_acl,
       a.grantor::regrole as grantor,
       case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
       a.privilege_type, a.is_grantable
from acl_layers l left join lateral aclexplode(
  case when cardinality(l.acl)=0 then null::aclitem[] else l.acl end
) a on true
order by l.layer, a.grantee, a.privilege_type;

-- Inheritance AND SET-role paths can defeat assumptions about effective access.
-- The new-function direct service_role revoke does not change any such paths.
with intended(role_name) as (values ('postgres'::name)),
owner_role as (select r.oid from pg_roles r join intended i on r.rolname=i.role_name)
select c.rolname as api_role, o.oid::regrole as intended_owner,
       pg_has_role(c.oid,o.oid,'USAGE') as inherits_owner,
       pg_has_role(c.oid,o.oid,'SET') as can_set_owner,
       pg_has_role(c.oid,a.oid,'USAGE') as inherits_authenticated,
       pg_has_role(c.oid,a.oid,'SET') as can_set_authenticated
from pg_roles c
left join owner_role o on true
left join pg_roles a on a.rolname='authenticated'
where c.rolname in ('anon','authenticated','service_role')
order by c.rolname;

-- Mixed paths: SET can reach a bridge that INHERITS authenticated/owner even
-- when the direct API-to-privileged-role USAGE and SET checks both say false.
-- Enumerate every SET-reachable role (including self), then its effective
-- inherited privileges. Rows here require target-specific review, not changes.
with intended(role_name) as (values ('postgres'::name)),
owner_role as (select r.oid from pg_roles r join intended i on r.rolname=i.role_name)
select c.rolname as api_role, b.rolname as reachable_set_role,
       o.oid::regrole as intended_owner,
       pg_has_role(b.oid,o.oid,'USAGE') as bridge_inherits_owner,
       pg_has_role(b.oid,a.oid,'USAGE') as bridge_inherits_authenticated
from pg_roles c
join pg_roles b on pg_has_role(c.oid,b.oid,'SET')
left join owner_role o on true
left join pg_roles a on a.rolname='authenticated'
where c.rolname in ('anon','authenticated','service_role')
  and (pg_has_role(b.oid,o.oid,'USAGE') or pg_has_role(b.oid,a.oid,'USAGE'))
order by c.rolname,b.rolname;

-- Every same-name function/overload, not just uuid. Forward requires NONE.
select p.oid::regprocedure as identity, pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result, p.proowner::regrole as owner,
       p.prokind, p.prosecdef, p.provolatile, p.proconfig,
       p.proacl as explicit_acl, md5(p.prosrc) as body_catalog_fingerprint
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='get_pharmacy_business_day_status'
order by p.oid;

-- Complete ACL of any existing same-name function, including default PUBLIC.
select p.oid::regprocedure as identity, a.grantor::regrole as grantor,
       case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
       a.privilege_type, a.is_grantable
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
where n.nspname='public' and p.proname='get_pharmacy_business_day_status'
order by p.oid,a.grantee,a.privilege_type;

-- Any existing same-name object or unexpected owner/default grants/role paths
-- requires review, not replacement, broad revocation or default-privilege edits.
rollback;
