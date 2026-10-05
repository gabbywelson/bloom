/**
 * Post-processing of the generated OpenAPI document, applied through the
 * `transform` annotation on `BloomApi` so `openapi.json` and the document the
 * server serves at `/api/openapi.json` are identical.
 *
 * Effect emits a correct document; these steps make it more useful to code
 * generators (the Swift client, ADR 0017):
 *
 * 1. The chat stream's events (`ChatStreamEvent`) become named components and
 *    the SSE `data` field points at them with `contentSchema`. Effect describes
 *    the stream envelope only (`data` is a JSON string), so without this the
 *    event types would not appear in the document at all.
 * 2. Tagged unions (`anyOf` of named object schemas that share a required
 *    single-literal property) become `oneOf` with a `discriminator` mapping.
 *    That is what lets generators emit a real enum instead of trying every
 *    member. The schemas already guarantee that exactly one member matches,
 *    so `oneOf` states nothing new.
 * 3. Nullable values (`anyOf: [X, { type: "null" }]`, how Effect writes
 *    `Schema.NullOr`) become `X` with `"null"` added to its `type` (and to
 *    its `enum`), the conventional OpenAPI 3.1 form. swift-openapi-generator
 *    rejects a bare `{ type: "null" }` member and drops the whole property.
 *    A nullable `$ref` to a primitive component is inlined to get there; a
 *    nullable `$ref` to an object stays an `anyOf` (no such field exists yet,
 *    and the generator would drop it: add a test before introducing one).
 */
import { ChatStreamEvent } from "@bloom/domain";
import { JsonSchema, Schema } from "effect";

type Json = JsonSchema.JsonSchema;

const COMPONENT_REF_PREFIX = "#/components/schemas/";
/** The operation that streams `ChatStreamEvent`s (`POST /api/threads/{id}/messages`). */
export const CHAT_STREAM_OPERATION_ID = "messages.send";

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordAt = (value: Json, key: string): Json | undefined => {
  const child = value[key];
  return isRecord(child) ? child : undefined;
};

const componentRef = (name: string): Json => ({ $ref: `${COMPONENT_REF_PREFIX}${name}` });

const refName = (schema: unknown): string | undefined => {
  if (!isRecord(schema) || typeof schema["$ref"] !== "string") return undefined;
  const ref = schema["$ref"];
  return ref.startsWith(COMPONENT_REF_PREFIX) ? ref.slice(COMPONENT_REF_PREFIX.length) : undefined;
};

/** Structural equality for JSON values (key order ignored). */
export const jsonEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => jsonEqual(item, b[index]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
  );
};

/**
 * `ChatStreamEvent` as OpenAPI 3.1 component schemas: the root is a
 * `$ref` to `ChatStreamEvent` and `definitions` holds it plus every named
 * schema it reaches (events, `Message`, `MessagePart`, `UiComponent`, ...).
 */
export const chatStreamEventComponents = (): JsonSchema.MultiDocument<"openapi-3.1"> => {
  const document = Schema.toJsonSchemaDocument(ChatStreamEvent, { onExcessProperty: "error" });
  return JsonSchema.toMultiDocumentOpenApi3_1({
    dialect: document.dialect,
    schemas: [document.schema],
    definitions: document.definitions,
  });
};

/**
 * Adds the `ChatStreamEvent` components (step 1). A definition that already
 * exists in the document is kept as is; the test suite asserts both copies
 * are identical, so a drift between them is caught there.
 */
export const addChatStreamEvents = (spec: Json): Json => {
  const components = recordAt(spec, "components");
  const schemas = components === undefined ? undefined : recordAt(components, "schemas");
  if (schemas === undefined) return spec;
  const stream = chatStreamEventComponents();
  for (const [name, definition] of Object.entries(stream.definitions)) {
    if (!Object.hasOwn(schemas, name)) schemas[name] = definition;
  }
  const root = refName(stream.schemas[0]);
  if (root === undefined) return spec;

  const paths = recordAt(spec, "paths") ?? {};
  for (const pathItem of Object.values(paths)) {
    if (!isRecord(pathItem)) continue;
    for (const operation of Object.values(pathItem)) {
      if (!isRecord(operation) || operation["operationId"] !== CHAT_STREAM_OPERATION_ID) continue;
      const responses = recordAt(operation, "responses") ?? {};
      for (const response of Object.values(responses)) {
        if (!isRecord(response)) continue;
        const sse = recordAt(recordAt(response, "content") ?? {}, "text/event-stream");
        const data = recordAt(
          recordAt(recordAt(sse ?? {}, "schema") ?? {}, "properties") ?? {},
          "data",
        );
        if (data === undefined) continue;
        // `data` is usually a `$ref` to the JSON-string component; describe that component.
        const dataRef = refName(data);
        const target = dataRef === undefined ? data : recordAt(schemas, dataRef);
        if (target !== undefined) target["contentSchema"] = componentRef(root);
      }
    }
  }
  return spec;
};

/** The single value of a `{ type: "string", enum: [value] }` property, if that is its schema. */
const singleLiteral = (schema: Json, property: string): string | undefined => {
  const required = schema["required"];
  if (!Array.isArray(required) || !required.includes(property)) return undefined;
  const propertySchema = recordAt(recordAt(schema, "properties") ?? {}, property);
  const values = propertySchema?.["enum"];
  return Array.isArray(values) && values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : undefined;
};

/** A discriminator for a union of named object schemas, when one exists. */
export const findDiscriminator = (
  schemas: Json,
  members: ReadonlyArray<unknown>,
): { readonly propertyName: string; readonly mapping: Record<string, string> } | undefined => {
  const named = members.map((member) => {
    const name = refName(member);
    const schema = name === undefined ? undefined : recordAt(schemas, name);
    return name === undefined || schema === undefined ? undefined : { name, schema };
  });
  const first = named[0];
  if (named.length < 2 || first === undefined || named.some((member) => member === undefined)) {
    return undefined;
  }
  const candidates = Object.keys(recordAt(first.schema, "properties") ?? {});
  for (const propertyName of candidates) {
    const mapping: Record<string, string> = {};
    const complete = named.every((member) => {
      const value = member === undefined ? undefined : singleLiteral(member.schema, propertyName);
      if (member === undefined || value === undefined || Object.hasOwn(mapping, value)) {
        return false;
      }
      mapping[value] = `${COMPONENT_REF_PREFIX}${member.name}`;
      return true;
    });
    if (complete) return { propertyName, mapping };
  }
  return undefined;
};

/** Rewrites every discriminable top-level component union as `oneOf` + `discriminator` (step 2). */
export const addDiscriminators = (spec: Json): Json => {
  const components = recordAt(spec, "components");
  const schemas = components === undefined ? undefined : recordAt(components, "schemas");
  if (schemas === undefined) return spec;
  for (const schema of Object.values(schemas)) {
    if (!isRecord(schema)) continue;
    const members = schema["anyOf"] ?? schema["oneOf"];
    if (!Array.isArray(members)) continue;
    const discriminator = findDiscriminator(schemas, members);
    if (discriminator === undefined) continue;
    delete schema["anyOf"];
    schema["oneOf"] = members;
    schema["discriminator"] = { ...discriminator, mapping: { ...discriminator.mapping } };
  }
  return spec;
};

const PRIMITIVE_TYPES = new Set(["string", "integer", "number", "boolean"]);

const isNullSchema = (schema: unknown): boolean =>
  isRecord(schema) && schema["type"] === "null" && Object.keys(schema).length === 1;

/**
 * `X | null` as a single schema with `"null"` in its type, or `undefined` when
 * that is not possible: `X` has no single `type`, or `X` is a `$ref` to
 * anything but a primitive (inlining a named object would duplicate it).
 */
const asNullable = (schemas: Json, member: Json): Json | undefined => {
  const name = refName(member);
  const target = name === undefined ? member : recordAt(schemas, name);
  if (target === undefined) return undefined;
  const type = target["type"];
  if (typeof type !== "string" || type === "null") return undefined;
  if (name !== undefined && !PRIMITIVE_TYPES.has(type)) return undefined;
  const nullable: Json = { ...structuredClone(target), type: [type, "null"] };
  const values = target["enum"];
  if (Array.isArray(values)) nullable["enum"] = [...values, null];
  return nullable;
};

/** Rewrites every two-member `anyOf`/`oneOf` with a `null` member, anywhere in the document (step 3). */
export const normalizeNullable = (spec: Json): Json => {
  const components = recordAt(spec, "components");
  const schemas = (components === undefined ? undefined : recordAt(components, "schemas")) ?? {};
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;
    for (const key of ["anyOf", "oneOf"]) {
      const members = node[key];
      if (!Array.isArray(members) || members.length !== 2) continue;
      const nullIndex = members.findIndex(isNullSchema);
      const other = members[1 - nullIndex];
      if (nullIndex < 0 || !isRecord(other)) continue;
      const nullable = asNullable(schemas, other);
      if (nullable === undefined) continue;
      delete node[key];
      Object.assign(node, nullable);
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(spec);
  return spec;
};

/** The transform installed on `BloomApi`. Works on a copy; the input is not mutated. */
export const bloomOpenApiTransform = (spec: Record<string, unknown>): Record<string, unknown> =>
  normalizeNullable(addDiscriminators(addChatStreamEvents(structuredClone(spec))));
