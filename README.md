# PharmaPilot Command

I am building a SaaS application called PharmaPilot AI.

PharmaPilot AI is a mobile-first pharmacy business management and decision-intelligence platform designed initially for independent small and medium-sized pharmacies in Nigeria.

IMPORTANT: For this first phase, DO NOT create or modify any database tables, Supabase schema, Edge Functions, authentication backend, APIs, or production business logic. We are establishing the frontend application architecture and design system first. Backend implementation will follow an approved technical architecture.

PRODUCT PURPOSE

PharmaPilot AI helps a pharmacy owner answer five questions quickly:

1. How much did I sell?

2. How much did I make?

3. Is my money complete?

4. What stock am I losing or about to run out of?

5. What should I do next?

The product must feel much simpler than traditional pharmacy ERP software.

PRIMARY USERS

1. Pharmacy Owner / Admin

2. Superintendent Pharmacist / Pharmacy Manager

3. Cashier / Pharmacy Assistant

4. Accountant

DEVICE STRATEGY

The application must be responsive.

The Pharmacy Owner experience is MOBILE-FIRST because many Nigerian pharmacy owners primarily use smartphones.

The pharmacy counter / POS experience should be optimized for desktop and tablet while remaining usable on mobile.

DESIGN CHARACTER

Create a calm, trustworthy, modern and professional healthcare-business interface.

Do not make it look like a hospital EMR.

Do not make it look like a flashy fintech app.

Do not make it visually complex like traditional ERP software.

Use:

- generous spacing

- strong readability

- clear typography

- restrained semantic colors

- obvious action buttons

- labeled navigation

- large touch targets

- accessible contrast

- clean cards only where grouping is useful

- responsive layouts

Use a professional sans-serif font such as Inter.

APPLICATION STRUCTURE

Create two responsive experiences within one application:

A. OWNER MODE — mobile-first

Primary bottom navigation:

Home

Actions

Inventory

Money

Ask AI

The Owner Home / Command Center should prioritize:

Today's Sales

Gross Margin

Estimated Net Profit

Cash / Reconciliation Status

Out-of-Stock Items

Low-Stock Items

Expiry Risk

Top 3-5 Actions Requiring Attention

Daily Business Brief

Do not make charts the dominant element.

The owner should understand the health of the pharmacy within approximately 60 seconds.

B. OPERATIONS MODE — desktop/tablet primary

Use a labeled left sidebar with:

Sell / POS

Products

Receive Stock

Inventory

Expiry

Expenses

Close Day

Reports

POS SCREEN

Create a fast pharmacy POS workspace.

On desktop/tablet:

- Large product search field

- Search by medicine name, generic name or barcode

- Product search results

- Persistent cart on the right

- Quantity

- Selling unit

- Price

- Payment

- Clear checkout button

Pharmacy products may be sold in different units.

Example:

Paracetamol 500 mg

1 tin = 100 tablets

The pharmacy may sell:

- 1 tablet

- 10 tablets

- 1 full tin

The interface therefore needs a simple selling-unit selector.

The POS must also support non-stock services.

Example customer bill:

Pharmacist Consultation — ₦3,000

Paracetamol 500 mg — 10 tablets — ₦500

Amoxicillin 500 mg — 1 pack — ₦3,200

Total — ₦6,700

Consultation/service items should be visually distinguishable from physical inventory items.

OTHER CORE SCREEN PLACEHOLDERS

Create frontend routes and placeholder screens for:

Inventory

Expiry Center

Receive Stock

Expenses

Daily Reconciliation

Action Center

Reports

Users & Roles

Service Catalog

Product Packaging Setup

Ask PharmaPilot AI

For now these screens may use realistic MOCK DATA.

DO NOT build actual backend logic yet.

MOBILE OWNER HOME

Use realistic Nigerian Naira examples such as:

Sales: ₦386,400

Gross Margin: ₦91,600

Estimated Net Profit: ₦67,300

Example alert:

Cash is ₦12,400 short.

Example actions:

Amoxicillin 500mg — Out of stock

4 batches — Expire within 30 days

Stock adjustment — ₦18,000 variance to review

ASK PHARMAPILOT AI SCREEN

Create a conversational interface.

Example user question:

"Why is cash short today?"

The answer UI must visually separate:

VERIFIED FACTS

from

RECOMMENDATIONS

Include links/placeholders such as "View reconciliation records".

IMPORTANT PRODUCT RULES

These rules must influence the frontend architecture, but do not implement the backend yet:

- Inventory ultimately uses a base-unit model.

- Products can have multiple packaging/selling units.

- Batch and expiry tracking are important.

- Services generate revenue but do not reduce inventory.

- Product revenue and service revenue must be distinguishable.

- Stock movements will ultimately be immutable ledger events.

- AI is advisory and must not silently alter financial or inventory records.

- Role permissions will ultimately be enforced server-side.

- Offline POS capability will be added later.

- The interface must show synchronization/connectivity status where appropriate.

TECHNICAL FRONTEND DIRECTION

Use a clean component-based React/TypeScript architecture compatible with Lovable.

Create reusable components rather than duplicating UI.

Establish:

- application shell

- responsive navigation

- design tokens

- typography hierarchy

- reusable KPI cards

- status badges

- action cards

- product result rows

- cart line items

- service line items

- empty states

- loading states

- error states

- mobile and desktop responsive behavior

Do not over-engineer.

Do not create a database.

Do not create Supabase tables.

Do not implement production authentication yet.

Do not add payments.

Do not integrate OpenAI yet.

Do not publish the application yet.

FIRST TASK

Before building, analyze these requirements in Plan mode.

Give me:

1. Your proposed frontend architecture.

2. The routes/screens you intend to create.

3. The reusable component structure.

4. The responsive mobile/desktop strategy.

5. Any questions or assumptions that need clarification.

Do not write code until I approve the plan.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/845ab223-c095-45c5-aedf-d48409d57dee).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
