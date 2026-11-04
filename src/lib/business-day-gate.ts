export type BusinessDayStatus = {
  kind: "checking" | "open" | "closed" | "error";
  business_date?: string;
};
type Dependencies = {
  read: (signal: AbortSignal) => Promise<unknown>;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};
export const BUSINESS_DAY_POLL_MS = 15_000;
export const BUSINESS_DAY_TIMEOUT_MS = 10_000;

/** Lagos is UTC+01:00 year-round. This gate never owns or clears saved requests. */
export class BusinessDayGate {
  private current: BusinessDayStatus = { kind: "checking" };
  private verifiedAt = -Infinity;
  private closedDate: string | undefined;
  private epoch = 0;
  private disposed = false;
  private listeners = new Set<() => void>();
  private flight: { promise: Promise<void>; submission: boolean; cancel: () => void } | undefined;
  constructor(
    private pharmacyId: string | undefined,
    private userId: string | undefined,
    private deps: Dependencies,
  ) {}
  private day() {
    return new Date(this.deps.now() + 3_600_000).toISOString().slice(0, 10);
  }
  get status(): BusinessDayStatus {
    if (this.disposed || !this.pharmacyId || !this.userId) return { kind: "checking" };
    const day = this.day();
    if (this.closedDate === day) return { kind: "closed", business_date: day };
    if (this.current.business_date && this.current.business_date !== day)
      return { kind: "checking" };
    const age = this.deps.now() - this.verifiedAt;
    if (this.current.kind === "open" && (age < 0 || age >= BUSINESS_DAY_POLL_MS))
      return { kind: "checking" };
    return this.current;
  }
  get blocked() {
    return this.status.kind !== "open";
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    if (!this.disposed) for (const listener of this.listeners) listener();
  }
  markClosed = (attemptDate: string = this.day()) => {
    // A rejection can arrive after Lagos midnight; never close the next day.
    if (this.disposed || attemptDate !== this.day()) return;
    this.epoch++;
    this.closedDate = this.day();
    this.current = { kind: "closed", business_date: this.closedDate };
    this.emit();
  };
  private read(submission: boolean): Promise<void> {
    if (this.disposed || !this.pharmacyId || !this.userId) return Promise.resolve();
    if (this.flight) return this.flight.promise;
    const day = this.day(),
      epoch = this.epoch;
    this.current = { kind: "checking", business_date: day };
    this.emit();
    const transport = new AbortController();
    let finish!: (result?: unknown) => void;
    const promise = new Promise<void>((resolve) => {
      let done = false;
      const timer = this.deps.setTimeout(() => finish(), BUSINESS_DAY_TIMEOUT_MS);
      finish = (result?: unknown) => {
        if (done) return;
        done = true;
        if (result === undefined) transport.abort();
        this.deps.clearTimeout(timer);
        this.flight = undefined;
        if (!this.disposed && epoch === this.epoch && day === this.day()) {
          const row = result as Record<string, unknown> | null | undefined;
          if (
            row &&
            row["pharmacyId"] === this.pharmacyId &&
            row["userId"] === this.userId &&
            row["business_date"] === day &&
            typeof row["is_closed"] === "boolean"
          ) {
            this.verifiedAt = this.deps.now();
            if (row["is_closed"]) this.closedDate = day;
            this.current = { kind: row["is_closed"] ? "closed" : "open", business_date: day };
          } else {
            this.current = { kind: "error", business_date: day };
          }
          this.emit();
        }
        resolve();
      };
    });
    this.flight = { promise, submission, cancel: () => finish() };
    // Abort bounds the transport too; late/uncooperative replies stay ignored.
    try {
      this.deps.read(transport.signal).then(finish, () => finish());
    } catch {
      finish();
    }
    return promise;
  }
  refresh = (): Promise<void> => this.read(false);
  canSubmit = async (loadedBusinessDate?: string | null): Promise<boolean> => {
    if (this.disposed || !this.pharmacyId || !this.userId) return false;
    // A pre-existing poll is not a fresh submission preflight. Concurrent
    // submission preflights may share the read they initiate together.
    if (this.flight && !this.flight.submission) await this.flight.promise;
    await this.read(true);
    return (
      !this.blocked &&
      (loadedBusinessDate === undefined || loadedBusinessDate === this.status.business_date)
    );
  };
  /** React StrictMode may replay effect setup after its cleanup. */
  activate = () => {
    this.disposed = false;
  };
  dispose = () => {
    this.disposed = true;
    this.epoch++;
    this.flight?.cancel();
    this.listeners.clear();
  };
}
