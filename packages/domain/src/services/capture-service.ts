import { Context, DateTime, Effect, Layer, Ref } from "effect";
import type { Actor } from "../actor.ts";
import { Capture, type CaptureCreate, type CaptureStatus, type CaptureUpdate } from "../capture.ts";
import { CaptureNotFound } from "../errors.ts";
import type { CaptureId } from "../ids.ts";

/** Optional filter for `CaptureService.list`. */
export interface CaptureListFilter {
  readonly status?: ReadonlyArray<CaptureStatus>;
}

/**
 * Raw captures waiting for triage. The only way clients, agents and the
 * pipeline may create or triage captures.
 *
 * Ordering contract: `list` returns captures in creation order (by
 * `(created_at, seq)` in the database, insertion order in memory).
 * `kind` and `payload` never change; `update` patches `transcript`, `status`
 * and `routedTo` and bumps `updatedAt`.
 */
export interface CaptureServiceShape {
  readonly create: (input: CaptureCreate, actor: Actor) => Effect.Effect<Capture>;
  readonly list: (filter?: CaptureListFilter) => Effect.Effect<ReadonlyArray<Capture>>;
  readonly get: (id: CaptureId) => Effect.Effect<Capture, CaptureNotFound>;
  readonly update: (
    id: CaptureId,
    patch: CaptureUpdate,
    actor: Actor,
  ) => Effect.Effect<Capture, CaptureNotFound>;
}

/** Capture domain service with a Ref-backed `layerMemory` for tests; the DB layer lives in `@bloom/db`. */
export class CaptureService extends Context.Service<CaptureService, CaptureServiceShape>()(
  "bloom/domain/CaptureService",
) {
  static readonly layerMemory = Layer.effect(
    CaptureService,
    Effect.gen(function* () {
      // Map iteration order is insertion order, so the store is the creation-order index.
      const store = yield* Ref.make(new Map<CaptureId, Capture>());

      const lookup = Effect.fnUntraced(function* (id: CaptureId) {
        const capture = (yield* Ref.get(store)).get(id);
        if (capture === undefined) {
          return yield* new CaptureNotFound({ id });
        }
        return capture;
      });

      const put = (capture: Capture) =>
        Ref.update(store, (captures) => new Map(captures).set(capture.id, capture));

      const create = Effect.fn("CaptureService.create")(function* (
        input: CaptureCreate,
        _actor: Actor,
      ) {
        const capture = new Capture(yield* Capture.insert.makeEffect(input).pipe(Effect.orDie));
        yield* put(capture);
        return capture;
      });

      const list = Effect.fn("CaptureService.list")(function* (filter?: CaptureListFilter) {
        const captures = Array.from((yield* Ref.get(store)).values());
        const statuses = filter?.status;
        return statuses === undefined
          ? captures
          : captures.filter((capture) => statuses.includes(capture.status));
      });

      const get = Effect.fn("CaptureService.get")(function* (id: CaptureId) {
        return yield* lookup(id);
      });

      const update = Effect.fn("CaptureService.update")(function* (
        id: CaptureId,
        patch: CaptureUpdate,
        _actor: Actor,
      ) {
        const existing = yield* lookup(id);
        const now = yield* DateTime.now;
        // oxlint-disable-next-line typescript/no-misused-spread -- fields are copied; the class constructor re-validates
        const next = new Capture({ ...existing, ...patch, updatedAt: now });
        yield* put(next);
        return next;
      });

      return CaptureService.of({ create, list, get, update });
    }),
  );
}
