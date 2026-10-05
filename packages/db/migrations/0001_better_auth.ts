import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Better Auth owns these tables and their camelCase quoted identifiers; the
 * statements are what `npx @better-auth/cli generate` emitted for the
 * passkey + magic-link setup and are executed verbatim. Do not rename columns.
 *
 * This module is the single source of truth (the generated .sql file is not
 * kept). If the Better Auth schema changes, regenerate to a scratch path and
 * add the diff as a NEW migration (e.g. 0003_better_auth_<change>.ts); never
 * edit these statements once applied.
 */
export const betterAuthStatements: ReadonlyArray<string> = [
  `create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null)`,
  `create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade)`,
  `create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null)`,
  `create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null)`,
  `create table "passkey" ("id" text not null primary key, "name" text, "publicKey" text not null, "userId" text not null references "user" ("id") on delete cascade, "credentialID" text not null, "counter" integer not null, "deviceType" text not null, "backedUp" boolean not null, "transports" text, "createdAt" timestamptz, "aaguid" text)`,
  `create index "session_userId_idx" on "session" ("userId")`,
  `create index "account_userId_idx" on "account" ("userId")`,
  `create index "verification_identifier_idx" on "verification" ("identifier")`,
  `create index "passkey_userId_idx" on "passkey" ("userId")`,
  `create index "passkey_credentialID_idx" on "passkey" ("credentialID")`,
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of betterAuthStatements) {
    yield* sql.unsafe(statement);
  }
});
