import {
  type Actor,
  Capture,
  type CaptureCreate,
  type CaptureId,
  type CaptureListFilter,
  CaptureNotFound,
  CaptureService,
  type CaptureUpdate,
} from "@bloom/domain";
import { DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { makeCaptureRepo } from "../repos/captures.ts";
import { makeEventRepo } from "../repos/events.ts";
import { makeIngest } from "./event-sink.ts";

type AuditType = "capture.created" | "capture.updated";

const encodePatch = Schema.encodeEffect(Capture.jsonUpdate);
const asJson = Schema.decodeUnknownEffect(Schema.Json);

/**
 * Postgres-backed `CaptureService`. Each mutation runs in one transaction with
 * an audit `Event` (source "domain"); `capture.created` is also how the
 * pipeline will learn about new captures. The payload never enters the event:
 * it can be a whole photo.
 */
export const CaptureServiceDb: Layer.Layer<CaptureService, never, SqlClient.SqlClient> =
  Layer.effect(
    CaptureService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repo = yield* makeCaptureRepo;
      const ingest = makeIngest(yield* makeEventRepo);

      const notFound = (id: CaptureId) => ({
        NoSuchElementError: () => new CaptureNotFound({ id }),
        SchemaError: Effect.die,
        SqlError: Effect.die,
      });

      const audit = Effect.fnUntraced(function* (
        type: AuditType,
        capture: Capture,
        actor: Actor,
        changes?: CaptureUpdate,
      ) {
        const encodedChanges =
          changes === undefined ? undefined : yield* encodePatch(changes).pipe(Effect.orDie);
        const base = { captureId: capture.id, kind: capture.kind, actor };
        const payload = yield* asJson(
          encodedChanges === undefined ? base : { ...base, changes: encodedChanges },
        ).pipe(Effect.orDie);
        yield* ingest({ source: "domain", type, occurredAt: yield* DateTime.now, payload });
      });

      const create = Effect.fn("CaptureService.create")(function* (
        input: CaptureCreate,
        actor: Actor,
      ) {
        const row = yield* Capture.insert.makeEffect(input).pipe(Effect.orDie);
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const capture = yield* repo.insert(row);
              yield* audit("capture.created", capture, actor);
              return capture;
            }),
          )
          .pipe(Effect.orDie);
      });

      const list = Effect.fn("CaptureService.list")(function* (filter?: CaptureListFilter) {
        return yield* repo
          .list(filter?.status === undefined ? {} : { status: filter.status })
          .pipe(Effect.orDie);
      });

      const get = Effect.fn("CaptureService.get")(function* (id: CaptureId) {
        return yield* repo.findById(id).pipe(Effect.catchTags(notFound(id)));
      });

      const update = Effect.fn("CaptureService.update")(function* (
        id: CaptureId,
        patch: CaptureUpdate,
        actor: Actor,
      ) {
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const existing = yield* repo
                .findByIdForUpdate(id)
                .pipe(Effect.catchTags(notFound(id)));
              const row = yield* Capture.update
                .makeEffect({
                  id: existing.id,
                  transcript:
                    patch.transcript === undefined ? existing.transcript : patch.transcript,
                  status: patch.status ?? existing.status,
                  routedTo: patch.routedTo === undefined ? existing.routedTo : patch.routedTo,
                })
                .pipe(Effect.orDie);
              const capture = yield* repo.update(row).pipe(Effect.orDie);
              yield* audit("capture.updated", capture, actor, patch);
              return capture;
            }),
          )
          .pipe(Effect.catchTag("SqlError", Effect.die));
      });

      return CaptureService.of({ create, list, get, update });
    }),
  );
