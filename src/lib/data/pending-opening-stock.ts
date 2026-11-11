import {
  openingStockSubmissionSchema,
  openingStockSchema,
  type OpeningStockDraft,
  type OpeningStockSubmission,
} from "./opening-stock-schema";

export type OpeningStockScope = Pick<OpeningStockSubmission, "pharmacyId" | "userId">;
export type OpeningStockStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Tab-local durable outbox. Recovery is read-only; retries and acknowledgement are explicit. */
export class OpeningStockRecovery {
  readonly #scope: OpeningStockScope;
  readonly #storage: () => OpeningStockStorage;
  readonly #newId: () => string;
  #serialized: string | null = null;
  #ready = false;
  #busy = false;
  #confirmedId: string | null = null;

  constructor(
    scope: OpeningStockScope,
    storage: () => OpeningStockStorage,
    newId: () => string = () => crypto.randomUUID(),
  ) {
    this.#scope = openingStockSubmissionSchema
      .pick({ pharmacyId: true, userId: true })
      .parse(scope);
    this.#storage = storage;
    this.#newId = newId;
  }

  get key() {
    return `pharmanudge:pending-opening-stock:v1:${this.#scope.pharmacyId}:${this.#scope.userId}`;
  }
  get ready() {
    return this.#ready;
  }
  get busy() {
    return this.#busy;
  }
  get confirmedId() {
    return this.#confirmedId;
  }
  get pending(): OpeningStockSubmission | null {
    return this.#serialized === null ? null : JSON.parse(this.#serialized);
  }

  #adopt(raw: string) {
    if (raw.length > 256_000) throw new Error("Recovery record is too large.");
    const saved = openingStockSubmissionSchema.parse(JSON.parse(raw));
    if (
      saved.pharmacyId !== this.#scope.pharmacyId ||
      saved.userId !== this.#scope.userId ||
      JSON.stringify(saved) !== raw ||
      (this.#serialized !== null && this.#serialized !== raw)
    )
      throw new Error("Recovery scope or payload changed.");
    this.#serialized = raw;
  }

  recover(): OpeningStockSubmission | null {
    if (this.#busy) throw new Error("Opening stock confirmation is already in progress.");
    this.#ready = false;
    try {
      const raw = this.#storage().getItem(this.key);
      if (raw !== null) this.#adopt(raw);
      // Retain any in-memory reference if storage was lost; retry re-persists that exact request.
      this.#ready = true;
      return this.pending;
    } catch {
      throw new Error(
        "Saved opening stock recovery is blocked. Check storage availability and resolve any changed recovery record.",
      );
    }
  }

  async submit(
    draft: OpeningStockDraft | undefined,
    send: (request: OpeningStockSubmission) => Promise<string>,
  ) {
    if (this.#busy) throw new Error("Opening stock confirmation is already in progress.");
    if (!this.#ready) throw new Error("Recover saved opening stock before submitting.");
    this.#busy = true;
    try {
      let store: OpeningStockStorage;
      try {
        store = this.#storage();
        const raw = store.getItem(this.key);
        if (raw !== null) this.#adopt(raw);
      } catch {
        this.#ready = false;
        throw new Error(
          "Opening stock recovery storage is unavailable or changed. Recheck the saved opening stock.",
        );
      }
      if (this.#serialized !== null && draft !== undefined) {
        throw new Error("Resolve the saved pending opening stock before changing its payload.");
      }
      if (this.#confirmedId !== null) return this.#confirmedId;
      if (this.#serialized === null) {
        const request = openingStockSchema.parse({ ...draft, operation_id: this.#newId() });
        this.#serialized = JSON.stringify({ version: 1, ...this.#scope, request });
      }
      try {
        store.setItem(this.key, this.#serialized);
        if (store.getItem(this.key) !== this.#serialized)
          throw new Error("Recovery verification failed.");
      } catch {
        this.#ready = false;
        throw new Error(
          "Opening stock recovery storage is unavailable. Nothing new was dispatched; recheck the saved opening stock.",
        );
      }
      const snapshot = this.pending!;
      for (const item of snapshot.request.items) Object.freeze(item);
      Object.freeze(snapshot.request.items);
      Object.freeze(snapshot.request);
      Object.freeze(snapshot);
      const id = await send(snapshot);
      if (!openingStockSchema.shape.operation_id.safeParse(id).success) {
        throw new Error(
          "Opening stock confirmation did not return a valid reference. Retry the saved submission.",
        );
      }
      this.#confirmedId = id;
      // Keep durable recovery even after success until the user acknowledges this opening.
      return id;
    } finally {
      this.#busy = false;
    }
  }

  startAnother() {
    if (this.#busy) throw new Error("Opening stock confirmation is already in progress.");
    if (!this.#confirmedId || !this.#serialized)
      throw new Error("A confirmed opening stock is required before starting another opening.");
    if (!this.#ready) throw new Error("Recheck recovery storage before starting another opening.");
    try {
      const store = this.#storage();
      const raw = store.getItem(this.key);
      if (raw !== null && raw !== this.#serialized) throw new Error("Recovery record changed.");
      store.removeItem(this.key);
      if (store.getItem(this.key) !== null) throw new Error("Recovery removal failed.");
    } catch {
      this.#ready = false;
      throw new Error(
        "Cannot clear confirmed opening stock recovery while storage is unavailable or changed.",
      );
    }
    this.#serialized = null;
    this.#confirmedId = null;
  }
}
