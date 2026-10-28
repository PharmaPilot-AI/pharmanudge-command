# Email and recovery checkpoint — 28 October 2026

## Scope and evidence
Completed manual acceptance in pharmanudge-test (foatlexwlingrevefhbp), using the local Windows app at http://127.0.0.1:5173. Results were reported by the user and supported by screenshots. These are test-environment results, not production release certification.

- Password recovery: email arrived in Gmail; link opened reset form; password update succeeded; old password rejected; new password authenticated; used recovery link rejected on submission.
- Account without pharmacy membership remained blocked from pharmacy data after authentication.
- Staff registration: confirmation email arrived; explicit Verify email succeeded; invitation reference survived; correct alias signed in; acceptance led to Cashier Sell / POS in Operations mode.
- Invitation delivery: app sent via Resend API; Gmail received sender noreply@notify.pharmanudge.com, correct Cashier role and local invitation URL.
- Full journey from emailed invitation through registration, verification, acceptance and Cashier POS passed.
- User ran TypeScript noEmit check after sender change and reported success. Full automated release suite was not rerun today.

## Code checkpoint
Preserve uploaded src/lib/email/pharmacy-invitations.ts exactly. HTTP links are permitted only when NODE_ENV is development and hostname is localhost or 127.0.0.1; all other environments require HTTPS. Production behavior is unchanged.

## Test configuration (no secrets)
Supabase Authentication custom SMTP enabled:
- Sender: PharmaNudge <noreply@notify.pharmanudge.com>
- Host: smtp.resend.com; port: 465; username: resend.
- Password supplied privately as a Resend API key.
- Resend sending domain notify.pharmanudge.com was shown Verified.

Supabase Site URL: http://127.0.0.1:5173
Allowed redirect URLs:
- http://127.0.0.1:5173/reset-password
- http://127.0.0.1:5173/confirm-email?invitation=*

Runtime SITE_URL must match the local origin. APP_RESEND_API_KEY is required separately by the app invitation sender; configuring Supabase SMTP does not populate it. APP/VITE_SUPABASE_URL target the test project; corresponding anon/publishable keys and SESSION_SECRET were supplied for the process. No key values are stored here.

Dashboard reset-password and confirm-signup template bodies are preserved beside this note. They were saved manually to test Supabase; committing these HTML files does not deploy dashboard configuration. Signup RedirectTo already contains the invitation query parameter. Recovery RedirectTo has no query parameter.

## Next work
29 October: remaining verification — inventory outstanding cases, run appropriate automated checks, test authorization and failure paths including concurrent operations where applicable; verify closing actor display. Include confirmation-token reuse/expiry, unverified login and cancelled/expired invitation acceptance as outstanding negative cases.
30 October: feature-scope review against agreed MVP and broader project documents; identify deferred features explicitly.
31 October: release preparation — review/integrate checkpoint branches, configure real HTTPS deployment origins and secrets, align production SMTP/templates/redirects, disable email link tracking as appropriate, run deployed smoke tests and prepare rollback/runbook.

The current localhost email URLs work only on the computer running the dev server. Production HTTPS email journeys remain to be verified during release preparation. Production Supabase was not changed.

## Completion estimate
Email and recovery planned test-environment milestone: complete.
Four-area closeout plan: 1 of 4 milestones complete (25% by milestone count, not effort).
Overall MVP completion: rough planning estimate around 85%, not a measured coverage score or production-readiness claim; scope review may change it.
