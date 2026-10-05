# 0023. Devices: write-only APNs tokens, upserted by token, behind a Labs flag

Date: 2026-10-05

## Context

Nudges will reach the phone through APNs (the brief's Deliver stage). Sending
is not built, but the server needs to know where to send, and collecting
tokens early lets the delivery stage be built and tested against real
devices. Without a paid team there is no APNs key to send with anyway.

## Decision

- **Entity.** `Device` (`packages/domain`): `platform` (`ios`), `pushToken`,
  `pushEnvironment` (`sandbox` | `production`), optional `name` and
  `appVersion`, timestamps. `updatedAt` doubles as "last registered".
- **Write-only token.** `pushToken` exists in the database variants and in
  `jsonCreate`, but not in `json`: clients send it and never get it back,
  and it is absent from the OpenAPI response schema. Audit events
  (`device.registered`, `device.removed`) name the device, never the token.
- **Upsert by token.** `DeviceService.register` is
  `INSERT … ON CONFLICT (push_token) DO UPDATE`, so a phone re-registering on
  every launch (tokens can change; APNs recommends registering each launch)
  keeps one row, and two concurrent launches cannot create two.
- **API.** `POST /api/devices` (register), `GET /api/devices`,
  `DELETE /api/devices/:id` (204). Migration `0004_devices` adds the table.
- **iOS, behind a flag.** Settings → Labs → "Register for push"
  (`bloom.labs.push`, also settable as a launch argument). When on, the app
  asks for notification permission, calls
  `registerForRemoteNotifications()` and posts the hex token with
  `sandbox` (debug builds) or `production` (release). It re-registers on
  launch while the flag is on. The app's entitlements set
  `aps-environment` to `development`.
- **OpenAPI.** A one-literal `Schema.Literals(["ios"])` comes out of Effect
  as a one-member `anyOf`, which the Swift generator turns into a struct; the
  transform now unwraps one-member unions (ADR 0017's list grows by one).

## Consequences

- When nudge delivery lands it reads `DeviceService.list` and needs an APNs
  auth key (`.p8`) and team id in the server config; tokens from the
  simulator (80 bytes) are sandbox tokens.
- Turning the flag off does not unregister the device server-side; delete it
  with `DELETE /api/devices/:id` if needed. A real "unregister" can come with
  delivery.
- Verified on the simulator: the iOS permission alert, then a 200 from
  `POST /api/devices` and one `ios`/`sandbox` row in the dev database;
  `GET /api/devices` responses carry no token.
