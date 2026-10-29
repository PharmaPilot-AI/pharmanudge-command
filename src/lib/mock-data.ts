/**
 * Phase 1 mock fixtures. Realistic Nigerian pharmacy data, typed against the
 * domain model. Replaced by real backend reads in Phase 2 — nothing here
 * writes anywhere.
 */
import type {
  ActionItem,
  AiChatMessage,
  Batch,
  DailyKpis,
  Expense,
  Product,
  ServiceItem,
  TeamMember,
} from "./types";

/* ------------------------------ Team / roles ----------------------------- */

export const teamMembers: TeamMember[] = [
  { id: "u1", name: "Adaeze Okafor", role: "owner", roleLabel: "Owner / Admin", initials: "AO" },
  {
    id: "u2",
    name: "Dr. Chidi Nwosu",
    role: "pharmacist",
    roleLabel: "Superintendent Pharmacist",
    initials: "CN",
  },
  {
    id: "u3",
    name: "Blessing Eze",
    role: "cashier",
    roleLabel: "Cashier / Assistant",
    initials: "BE",
  },
  { id: "u4", name: "Tunde Bakare", role: "accountant", roleLabel: "Accountant", initials: "TB" },
];

/* -------------------------------- Products ------------------------------- */

export const products: Product[] = [
  {
    id: "p1",
    name: "Paracetamol 500mg",
    genericName: "Paracetamol (Emzor)",
    category: "Analgesics",
    barcode: "6151000100017",
    baseUnitLabel: "tablet",
    baseUnitsInStock: 1000,
    reorderLevelBaseUnits: 400,
    costPerBaseUnit: 22,
    shelfLocation: "Shelf A1",
    units: [
      { id: "p1-tab", label: "Tablet", baseUnitsPerUnit: 1, price: 50 },
      { id: "p1-strip", label: "Strip of 10", baseUnitsPerUnit: 10, price: 500 },
      { id: "p1-tin", label: "Tin of 100", baseUnitsPerUnit: 100, price: 4500 },
    ],
  },
  {
    id: "p2",
    name: "Amoxicillin 500mg",
    genericName: "Amoxicillin trihydrate",
    category: "Antibiotics",
    barcode: "6151000100024",
    baseUnitLabel: "capsule",
    baseUnitsInStock: 0,
    reorderLevelBaseUnits: 100,
    costPerBaseUnit: 190,
    shelfLocation: "Shelf B2",
    units: [
      { id: "p2-cap", label: "Capsule", baseUnitsPerUnit: 1, price: 350 },
      { id: "p2-pack", label: "Pack of 10", baseUnitsPerUnit: 10, price: 3200 },
    ],
  },
  {
    id: "p3",
    name: "Artemether/Lumefantrine 80/480mg",
    genericName: "Artemether + Lumefantrine",
    category: "Antimalarials",
    barcode: "6151000100031",
    baseUnitLabel: "tablet",
    baseUnitsInStock: 240,
    reorderLevelBaseUnits: 96,
    costPerBaseUnit: 145,
    shelfLocation: "Shelf A3",
    units: [
      { id: "p3-tab", label: "Tablet", baseUnitsPerUnit: 1, price: 220 },
      { id: "p3-course", label: "Full course (24)", baseUnitsPerUnit: 24, price: 4800 },
    ],
  },
  {
    id: "p4",
    name: "Metronidazole 400mg",
    genericName: "Metronidazole (Flagyl)",
    category: "Antibiotics",
    barcode: "6151000100048",
    baseUnitLabel: "tablet",
    baseUnitsInStock: 850,
    reorderLevelBaseUnits: 300,
    costPerBaseUnit: 18,
    shelfLocation: "Shelf B1",
    units: [
      { id: "p4-tab", label: "Tablet", baseUnitsPerUnit: 1, price: 40 },
      { id: "p4-strip", label: "Strip of 10", baseUnitsPerUnit: 10, price: 380 },
    ],
  },
  {
    id: "p5",
    name: "Cetirizine 10mg",
    genericName: "Cetirizine hydrochloride",
    category: "Antihistamines",
    barcode: "6151000100055",
    baseUnitLabel: "tablet",
    baseUnitsInStock: 620,
    reorderLevelBaseUnits: 200,
    costPerBaseUnit: 25,
    shelfLocation: "Shelf C2",
    units: [
      { id: "p5-tab", label: "Tablet", baseUnitsPerUnit: 1, price: 60 },
      { id: "p5-strip", label: "Strip of 10", baseUnitsPerUnit: 10, price: 550 },
    ],
  },
  {
    id: "p6",
    name: "Omeprazole 20mg",
    genericName: "Omeprazole",
    category: "Antacids & PPIs",
    barcode: "6151000100062",
    baseUnitLabel: "capsule",
    baseUnitsInStock: 450,
    reorderLevelBaseUnits: 140,
    costPerBaseUnit: 80,
    shelfLocation: "Shelf C1",
    units: [
      { id: "p6-cap", label: "Capsule", baseUnitsPerUnit: 1, price: 150 },
      { id: "p6-pack", label: "Pack of 14", baseUnitsPerUnit: 14, price: 1950 },
    ],
  },
  {
    id: "p7",
    name: "Ibuprofen 400mg",
    genericName: "Ibuprofen",
    category: "Analgesics",
    barcode: "6151000100079",
    baseUnitLabel: "tablet",
    baseUnitsInStock: 120,
    reorderLevelBaseUnits: 200,
    costPerBaseUnit: 24,
    shelfLocation: "Shelf A1",
    units: [
      { id: "p7-tab", label: "Tablet", baseUnitsPerUnit: 1, price: 50 },
      { id: "p7-strip", label: "Strip of 10", baseUnitsPerUnit: 10, price: 480 },
    ],
  },
  {
    id: "p8",
    name: "ORS Sachet",
    genericName: "Oral rehydration salts",
    category: "Rehydration",
    barcode: "6151000100086",
    baseUnitLabel: "sachet",
    baseUnitsInStock: 95,
    reorderLevelBaseUnits: 60,
    costPerBaseUnit: 70,
    shelfLocation: "Counter tray",
    units: [{ id: "p8-sachet", label: "Sachet", baseUnitsPerUnit: 1, price: 150 }],
  },
  {
    id: "p9",
    name: "Vitamin C 1000mg",
    genericName: "Ascorbic acid",
    category: "Supplements",
    barcode: "6151000100093",
    baseUnitLabel: "tablet",
    baseUnitsInStock: 540,
    reorderLevelBaseUnits: 100,
    costPerBaseUnit: 55,
    shelfLocation: "Shelf D3",
    units: [
      { id: "p9-tab", label: "Tablet", baseUnitsPerUnit: 1, price: 100 },
      { id: "p9-bottle", label: "Bottle of 20", baseUnitsPerUnit: 20, price: 1800 },
    ],
  },
  {
    id: "p10",
    name: "Cough Syrup 100ml",
    genericName: "Diphenhydramine expectorant",
    category: "Cough & Cold",
    barcode: "6151000100109",
    baseUnitLabel: "bottle",
    baseUnitsInStock: 12,
    reorderLevelBaseUnits: 15,
    costPerBaseUnit: 1100,
    shelfLocation: "Shelf D1",
    units: [{ id: "p10-bottle", label: "Bottle", baseUnitsPerUnit: 1, price: 1800 }],
  },
];

/* -------------------------------- Services ------------------------------- */

export const services: ServiceItem[] = [
  {
    id: "s1",
    name: "Pharmacist Consultation",
    description: "One-on-one medication review and advice",
    price: 3000,
    category: "Clinical",
    durationMinutes: 15,
  },
  {
    id: "s2",
    name: "Blood Pressure Check",
    description: "BP measurement with reading card",
    price: 500,
    category: "Screening",
    durationMinutes: 5,
  },
  {
    id: "s3",
    name: "Malaria Parasite Test (RDT)",
    description: "Rapid diagnostic test, results in 15 minutes",
    price: 1500,
    category: "Diagnostics",
    durationMinutes: 15,
  },
  {
    id: "s4",
    name: "Blood Glucose Test",
    description: "Fasting or random blood sugar check",
    price: 1000,
    category: "Diagnostics",
    durationMinutes: 10,
  },
  {
    id: "s5",
    name: "Wound Dressing",
    description: "Cleaning and dressing of minor wounds",
    price: 2000,
    category: "Clinical",
    durationMinutes: 20,
  },
];

/* --------------------------------- Batches ------------------------------- */

export const batches: Batch[] = [
  {
    id: "b1",
    productId: "p7",
    batchNumber: "IB-3345",
    expiryDate: "2026-09-05",
    daysToExpiry: 13,
    baseUnitsRemaining: 120,
    costPerBaseUnit: 24,
    supplier: "Emzor Pharmaceuticals",
  },
  {
    id: "b2",
    productId: "p9",
    batchNumber: "VC-5560",
    expiryDate: "2026-09-15",
    daysToExpiry: 23,
    baseUnitsRemaining: 100,
    costPerBaseUnit: 55,
    supplier: "Fidson Healthcare",
  },
  {
    id: "b3",
    productId: "p1",
    batchNumber: "PX-8821",
    expiryDate: "2026-09-10",
    daysToExpiry: 18,
    baseUnitsRemaining: 300,
    costPerBaseUnit: 22,
    supplier: "Emzor Pharmaceuticals",
  },
  {
    id: "b4",
    productId: "p10",
    batchNumber: "CS-1102",
    expiryDate: "2026-09-20",
    daysToExpiry: 28,
    baseUnitsRemaining: 12,
    costPerBaseUnit: 1100,
    supplier: "Orange Drugs",
  },
  {
    id: "b5",
    productId: "p1",
    batchNumber: "PX-9001",
    expiryDate: "2027-08-01",
    daysToExpiry: 343,
    baseUnitsRemaining: 700,
    costPerBaseUnit: 22,
    supplier: "Emzor Pharmaceuticals",
  },
  {
    id: "b6",
    productId: "p4",
    batchNumber: "MT-2210",
    expiryDate: "2027-03-15",
    daysToExpiry: 204,
    baseUnitsRemaining: 850,
    costPerBaseUnit: 18,
    supplier: "Swiss Pharma (Swipha)",
  },
  {
    id: "b7",
    productId: "p5",
    batchNumber: "CT-7731",
    expiryDate: "2026-10-22",
    daysToExpiry: 60,
    baseUnitsRemaining: 620,
    costPerBaseUnit: 25,
    supplier: "GSK Nigeria",
  },
  {
    id: "b8",
    productId: "p3",
    batchNumber: "AL-4410",
    expiryDate: "2027-01-30",
    daysToExpiry: 160,
    baseUnitsRemaining: 240,
    costPerBaseUnit: 145,
    supplier: "GSK Nigeria",
  },
];

/* --------------------------------- Actions ------------------------------- */

export const initialActions: ActionItem[] = [
  {
    id: "a1",
    severity: "critical",
    title: "Amoxicillin 500mg is out of stock",
    detail: "12 customer requests this week. Reordering today protects ~₦38,000 in weekly revenue.",
    ctaLabel: "Receive stock",
    ctaPath: "/receive-stock",
  },
  {
    id: "a2",
    severity: "critical",
    title: "Cash is ₦12,400 short",
    detail: "Yesterday's counted cash didn't match expected cash. Review before close of day.",
    amount: 12400,
    ctaLabel: "Review reconciliation",
    ctaPath: "/close-day",
  },
  {
    id: "a3",
    severity: "warning",
    title: "4 batches expire within 30 days",
    detail: "₦21,820 stock value at risk across Ibuprofen, Vitamin C, Paracetamol and Cough Syrup.",
    amount: 21820,
    ctaLabel: "Open Expiry Center",
    ctaPath: "/expiry",
  },
  {
    id: "a4",
    severity: "warning",
    title: "Stock adjustment variance of ₦18,000",
    detail: "Adjustment recorded by Blessing Eze on Aug 21 needs an owner's review.",
    amount: 18000,
    ctaLabel: "Review adjustment",
    ctaPath: "/inventory-ops",
  },
  {
    id: "a5",
    severity: "info",
    title: "Ibuprofen 400mg below reorder level",
    detail: "120 tablets left; reorder level is 200. Batch IB-3345 also expires in 13 days.",
    ctaLabel: "Plan reorder",
    ctaPath: "/inventory-ops",
  },
];

/* --------------------------------- Money --------------------------------- */

export const todayKpis: DailyKpis = {
  salesTotal: 386400,
  productRevenue: 358900,
  serviceRevenue: 27500,
  salesDeltaPct: 8,
  grossMargin: 91600,
  grossMarginPct: 23.7,
  estimatedNetProfit: 67300,
  expensesTotal: 24300,
  expectedCash: 248000,
  countedCash: 235600,
};

export const initialExpenses: Expense[] = [
  {
    id: "e1",
    category: "Utilities",
    description: "Generator fuel (20 litres)",
    amount: 15000,
    time: "7:40 AM",
    recordedBy: "Blessing Eze",
  },
  {
    id: "e2",
    category: "Supplies",
    description: "Packaging & nylon bags",
    amount: 2500,
    time: "10:15 AM",
    recordedBy: "Blessing Eze",
  },
  {
    id: "e3",
    category: "Bank & POS charges",
    description: "POS settlement charges",
    amount: 1850,
    time: "1:05 PM",
    recordedBy: "Tunde Bakare",
  },
  {
    id: "e4",
    category: "Logistics",
    description: "Dispatch delivery to supplier",
    amount: 4950,
    time: "3:30 PM",
    recordedBy: "Adaeze Okafor",
  },
];

export const expenseCategories = [
  "Utilities",
  "Supplies",
  "Logistics",
  "Bank & POS charges",
  "Salaries & wages",
  "Rent",
  "Other",
];

export const dailyBrief =
  "Sales are up 8% vs yesterday, driven by antimalarials and consultations. Cash is short ₦12,400 — review reconciliation before close of day. Amoxicillin is out of stock with 12 requests this week; reordering today protects about ₦38,000 in weekly revenue. Four batches expire within 30 days — consider a 10% clearance offer.";

/* ------------------------------- Ask AI demo ------------------------------ */

export const suggestedPrompts = [
  "Why is cash short today?",
  "What should I restock this week?",
  "Which products are most profitable?",
];

export const aiScriptedAnswers: Record<
  string,
  Omit<AiChatMessage, "id" | "role" | "text"> & { text: string }
> = {
  "why is cash short today?": {
    text: "Cash is ₦12,400 short against expectation. Here is what I can verify from today's records, and what I suggest doing about it.",
    facts: [
      "Expected cash was ₦248,000; the counted drawer was ₦235,600 — a variance of -₦12,400.",
      "3 cash refunds totaling ₦9,700 were recorded after the midday count.",
      "A ₦2,500 packaging expense was paid directly from the till at 10:15 AM.",
      "Card and transfer settlements matched their records exactly — the gap is cash-only.",
    ],
    recommendations: [
      "Re-count the drawer together with the cashier on duty (Blessing Eze) before close of day.",
      "Review the 3 refunds recorded after midday and confirm each has a receipt.",
      "Record till-paid expenses at the moment they happen so counts stay accurate.",
    ],
    sources: [
      { label: "View reconciliation records", path: "/close-day" },
      { label: "Review today's expenses", path: "/expenses" },
    ],
  },
  "what should i restock this week?": {
    text: "Two items need attention now, and one is approaching its reorder level.",
    facts: [
      "Amoxicillin 500mg is out of stock with 12 customer requests this week.",
      "Ibuprofen 400mg has 120 tablets left against a reorder level of 200 — and the remaining batch expires in 13 days.",
      "Cough Syrup 100ml has 12 bottles left against a reorder level of 15.",
    ],
    recommendations: [
      "Order 200 Amoxicillin 500mg capsules (20 packs) — protects ~₦38,000 in weekly revenue.",
      "Order a fresh Ibuprofen batch and sell through IB-3345 first, or return it to the supplier.",
      "Top up Cough Syrup to 24 bottles ahead of the weekend.",
    ],
    sources: [
      { label: "Open inventory intelligence", path: "/inventory" },
      { label: "Go to Receive Stock", path: "/receive-stock" },
    ],
  },
  "which products are most profitable?": {
    text: "Margin is concentrated in antimalarials and services this week.",
    facts: [
      "Artemether/Lumefantrine full courses contribute the highest product margin: ~₦1,320 per course (27.5%).",
      "Pharmacist Consultations added ₦16,500 this week at near-zero cost of sale.",
      "Paracetamol 500mg sells the most units but at ~56% of revenue going to cost, it is a volume line, not a margin line.",
    ],
    recommendations: [
      "Keep full-course antimalarial packs visible at the counter during malaria season.",
      "Bundle a free BP check with consultations to grow high-margin service revenue.",
    ],
    sources: [{ label: "Open Reports", path: "/reports" }],
  },
};

export const aiMockFallback =
  "This is a Phase 1 preview, so I can only answer from a scripted demo — a real AI connection comes later. Try one of the suggested questions below to see how verified answers will look.";

/* -------------------------------- Suppliers ------------------------------- */

export const suppliers = [
  "Emzor Pharmaceuticals",
  "Fidson Healthcare",
  "GSK Nigeria",
  "Orange Drugs",
  "Swiss Pharma (Swipha)",
  "Drugfield Pharmaceuticals",
];

/* ------------------------------- Derived sets ----------------------------- */

export const outOfStockProducts = products.filter((p) => p.baseUnitsInStock <= 0);
export const lowStockProducts = products.filter(
  (p) => p.baseUnitsInStock > 0 && p.baseUnitsInStock <= p.reorderLevelBaseUnits,
);
export const expiringBatches = batches
  .filter((b) => b.daysToExpiry <= 30)
  .sort((a, b) => a.daysToExpiry - b.daysToExpiry);

export const expiryValueAtRisk = expiringBatches.reduce(
  (sum, b) => sum + b.baseUnitsRemaining * b.costPerBaseUnit,
  0,
);

export const productById = (id: string): Product | undefined => products.find((p) => p.id === id);
