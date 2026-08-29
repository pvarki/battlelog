# BattleLog

Event log for PVARKI's situational-awareness stack: a Hono + Drizzle backend and a React UI in one pnpm workspace.

The backend captures, versions, and queries geo-tagged hybrid-threat events — a PostGIS-backed append-only event log with NATO Admiralty-Code reliability/credibility ratings and Hybrid CoE threat-domain tagging. The UI (`web/`) is a Vite + React SPA (TanStack Router, Mantine) served by the same Hono server in production.

## Quickstart

Prerequisites: a tool-version manager ([mise](https://mise.jdx.dev/) or [asdf](https://asdf-vm.com/)) and Docker. Pinned versions live in [`.tool-versions`](./.tool-versions): Node 24, pnpm 11, [prek](https://github.com/j178/prek) 0.4 (a single-binary reimplementation of `pre-commit`).

```bash
mise install                    # or: asdf install
cp server/.env.schema server/.env   # adjust as needed
pnpm install
prek install                    # register git hooks
docker compose up -d db         # local Postgres + PostGIS
pnpm -C server db:migrate
pnpm dev                        # server on :3000, UI (vite) on :5173
```

Then open:

- UI (dev, hot reload): <http://localhost:5173/> (proxies `/api` to :3000)
- API: <http://localhost:3000/api/v1/events>
- Swagger UI: <http://localhost:3000/api-docs> (enabled by default in dev)
- Health: <http://localhost:3000/healthz>

In production there is no separate UI server: `pnpm build` emits `web/dist`, which Hono serves (with an `index.html` fallback for client-side routes).

### Full stack via Docker

```bash
docker compose up --build       # app + db
```

## Scripts

Root scripts fan out to both packages; run package-specific ones with `pnpm -C server <script>` / `pnpm -C web <script>`.

| Command                              | Purpose                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `pnpm dev`                           | Both watch-mode servers (Hono :3000, Vite :5173)         |
| `pnpm build`                         | Compile server to `server/dist`, bundle UI to `web/dist` |
| `pnpm test`                          | Vitest (server)                                          |
| `pnpm check` / `pnpm check:fix`      | Biome lint + format (whole repo)                         |
| `pnpm typecheck`                     | `tsc --noEmit` in every package                          |
| `pnpm -C server start`               | Run the compiled server                                  |
| `pnpm -C server db:generate`         | Generate migration from schema diff                      |
| `pnpm -C server db:migrate`          | Apply migrations (ensures `postgis` extension)           |
| `pnpm -C server db:seed` / `db:fake` | Seed / insert fake dev data                              |
| `pnpm -C server db:studio`           | Drizzle Studio                                           |
| `pnpm -C server perf`                | Load-test suite (see `server/scripts/perf.ts`)           |

## Configuration

All runtime config flows through [varlock](https://varlock.dev/) and is declared in [`server/.env.schema`](./server/.env.schema). Schema changes regenerate `server/src/env.d.ts` via `pnpm -C server exec varlock typegen`. Notable knobs:

- `DATABASE_URL` — Postgres connection (defaults to the local compose DB in dev)
- `USE_SWAGGER` — Swagger UI exposure (on by default in dev)
- `RM_API_ENABLED` + `RM_MTLS_*` — opt-in Rasenmaeher (RM) integration with mTLS
- `OTEL_EXPORTER_OTLP_ENDPOINT` — when set, boots the OTel SDK in prod
- `TAK_STREAM_HOST`, `MATRIX_HOMESERVER_URL` — enable the ingesters (see below)

## Ingest

Two optional ingesters feed events in from the rest of the deployment. Both are
off unless their host is configured, so a deployment that passes no extra
environment behaves exactly as before.

_What_ they ingest is chosen at runtime, not in the environment: an admin manages
ingest setups at `/ingest` in the UI (`/api/v1/ingest/sources`), and changes take
effect within seconds without a restart. Admin rights come from RM through the
`/rmapi/api/v1/users/*` hooks, which is what the `users` table records.

There can be any number of setups per kind, each one a different search. Every
event records which setup produced it (`events.ingest_source_id`), so a dashboard
feed widget can be pointed at a chosen set of them — the picker lists setups by
the name their operator gave them, which is what those names are for. Names are
readable by any authenticated user (`GET /api/v1/ingest/names`); the searches
themselves stay admin-only.

### Startup sequence

The HTTP server comes up first and never waits for either ingester:

0. `container-init` sources miniwerk's `/pvarki/hosts_script.sh` so sibling
   product hostnames resolve to the docker gateway rather than to this
   container, and enrols us for a client certificate if we have none.
1. Migrations run, dashboard templates are seeded, the events listener starts.
2. `startTakIngest()` opens a TLS connection to `TAK_STREAM_HOST:TAK_STREAM_PORT`
   presenting the RM-issued client certificate, and reconnects every 5s for as
   long as that fails.
3. `startTakMissionIngest()` starts polling TAK's Marti API every 30s for
   changes to the Data Sync feeds a setup names. Separate from the stream: TAK
   pushes mission changes only to clients it has a uid for, and it learns a uid
   from that client's own position reports, which BattleLog deliberately never
   sends.
4. `startMatrixIngest()` asks RM for interop with the Matrix product, fetches the
   ingest bot's access token from it, and long-polls `/sync`.
5. All three report live state through `/api/v1/ingest/status` and per source in
   the settings page. None ever throws out to the process: TAK or Synapse being
   down must not stop BattleLog serving its own feed.

Events are inserted with the ordinary `createEvent`, so they reach browsers
through the existing `events_notify` trigger and SSE stream with no extra
plumbing.

### TAK

Connects to TAK Server's CoT stream as an ordinary TAK client over mTLS, using
the certificate `kw_product_init` writes to `/data/persistent` on first run.

TAK trusts the RM CA for TLS but also requires the certificate's CN to be a known
TAK user, so `takrmapi` has to enrol us first (its
`POST /api/v1/interop/add`, which RM calls on our behalf). Until it has, TAK
completes the handshake and then drops the connection — which shows up as a
reconnect loop with the reason on the source's status.

**If the stream sits in a reconnect loop, check TAK's own log first.** A working
certificate can still be refused, and the client cannot tell the two cases apart:
TAK completes the TLS handshake and then closes with
`tlsv1 alert internal error`. `takserver-messaging.log` distinguishes them.

- `Certificate error: peer not verified` with `General OpenSslEngine problem`
  and no OpenSSL error code means TAK's own trust manager threw. With
  `enableOCSP="true"` in `CoreConfig` this is almost always the OCSP check:
  TAK fetches the responder named in our certificate's AIA extension, RM serves
  it over HTTPS, and that call uses the **JVM** truststore rather than
  `takserver-truststore.jks`. On a local stack the responder is fronted by
  miniwerk's private CA, which the JVM does not trust, so the check throws and
  every client is refused. Fixed in `docker-atak-server` by importing
  `/ca_public/*.pem` into the JVM truststore at startup; if you are on an older
  image, `keytool -cacerts -storepass changeit -importcert -trustcacerts -alias
mw -file /ca_public/miniwerk_ca.pem` inside the TAK containers and restart
  them.
- `PEER_DID_NOT_RETURN_A_CERTIFICATE` means our certificate was never sent —
  look at `TAK_CLIENT_CERT_PATH` and `TAK_CLIENT_KEY_PATH`.
- No log line at all, connection dropped after the handshake: the CN is not an
  enrolled TAK user, or it has no out-group. `takrmapi` gives it
  `certmod -og default`; `x509addAnonymous="false"` in `CoreConfig` means the
  `__ANON__` group `enable_user.sh` assigns on its own is not enough.

### Keeping a feed without the automatic flood

Most of what a TAK net carries is machine-generated: every client re-sends its
own position every few seconds. Two fields exist for that, and they are the
first ones to reach for:

- **Produced by** (`hows`) matches CoT's `how`. `^h-` takes only what a person
  entered and drops every automatic self-report in one field; `^m-` does the
  opposite. This is usually the whole answer.
- **Except CoT type** (`excludeCotTypes`) rejects a match even when everything
  else accepts it. It is the only field that narrows — every other one widens —
  so "this whole feed except the position reports" cannot be said without it.
  `^a-f-G-U-C$` is the friendly position report.

Two worked examples:

| want                               | fields                                                |
| ---------------------------------- | ----------------------------------------------------- |
| one feed, without the flood        | GeoChat room `^RECON$`, Except CoT type `^a-f-G-U-C$` |
| anything a person reported from HQ | Produced by `^h-`, Sender role `^HQ$`                 |

**Sender role** (`roles`) reads `<__group role="...">`, the one place TAK carries
anything role-shaped — it has no server-side notion of a role, so this attribute
is what selects HQ traffic without naming callsigns.

Fields within one setup AND together. To ingest _either_ of two things, make two
setups: an event is taken when any setup matches it.

A TAK setup narrows the stream by CoT type, GeoChat room, sender, recipient, and
by the raw `<detail>` XML. Every field takes **unanchored regular expressions** —
one rule for all of them, rather than the prefix-here-exact-there mix this
started as, because a setup exists to express one search. `^a-f-` is a prefix,
`^RECON$` is exact, `^(ALPHA|BRAVO)-\d+$` is a set. Patterns are compiled and
validated when saved, so an unparseable one is a 400 rather than a filter that
silently matches nothing.

The `detail` field exists because TAK has no server-side notion of a client's
role: an ATAK operator's `HQ` role appears only inside `detail`. Read a real
event's detail to find what to match.

A setup with no filters set takes **every** CoT event on the stream, and the
settings page says so.

#### Data Sync feeds (missions)

A TAK setup that names one or more **Data Sync feeds** is a feed reader rather
than a stream filter: it polls `GET /Marti/api/missions/{name}/changes` every 30s
and turns every marker or file added to (or removed from) those feeds into an
entry. Its pattern fields do not apply — two transports, two kinds of setup.

This is the curated picture rather than the broadcast one. A marker only reaches
RECON because someone verified it and put it there, which is exactly the traffic
a log wants and exactly what the automatic position reports drown out.

- **Feed chat is not polled.** TAK relays it as ordinary GeoChat with the feed's
  chat room name, so an ordinary stream filter with `chatRooms: ["^RECON"]` takes
  it.
- **Reading a feed needs a role.** `/Marti/api/missions/**` is open to any
  authenticated TAK client, but each mission then resolves the caller's role from
  its `defaultRole` (or a subscription). A feed whose `defaultRole` grants
  nothing answers 403; the settings page shows the message, which names the knob.
- Polls overlap by 90s and dedupe on `source_uri`, so clock skew between TAK and
  BattleLog costs nothing. A poll after downtime reaches back to where the last
  one got to, capped at 24h so a week-old feed does not arrive all at once.
- Authors are named by device uid in the change log. BattleLog trades that for
  the callsign it has seen the uid use on the stream, and falls back to the uid
  rather than guessing.

### Matrix

Reads messages from selected rooms in the deployment's Matrix Space as the
`battlelog-bot` user matrixrmapi creates for us. The access token comes over the
product interop API using the same client certificate, so no Matrix secret is
ever put in this container's environment.

The ingester joins the rooms it is told to ingest, so adding a setup is enough:
a room the Space makes joinable is joined outright, and an invite-only one has
its invite accepted on the next cycle. A room it is not in reports `not-joined`
rather than looking healthy while delivering nothing.

### End-to-end encryption

Encrypted rooms are read too. Megolm keys travel client to device, never through
the server, so this needs a device of its own and the crypto machinery to go with
it — `@matrix-org/matrix-sdk-crypto-nodejs`, the same Rust implementation Element
uses, driven from the sync loop.

The device is what makes it possible, and it comes from matrixrmapi registering
the bot: registration binds a token to a device, whereas the admin
"login as user" API mints a device-less one that nothing can share keys with. The
device id comes back from `whoami`, and the crypto store is keyed by it under
`MATRIX_CRYPTO_STORE` — **on a persistent volume**, because it holds every room
key shared with that device. Lose it and everything encrypted before becomes
unreadable.

Two limits are inherent to megolm rather than to this implementation:

- **No history.** Keys are shared forward, so messages sent before the bot's
  device joined a room cannot be decrypted, ever.
- **Senders decide.** A client configured never to share with unverified devices
  will not share with ours. Element shares by default; verify the bot in your
  client if a particular person's messages stay unreadable.

An undecryptable event leaves the source reading "Waiting for keys" rather than
counting as a failure, since that is the normal state for a room the bot has just
joined.

`POST /api/v1/ingest/matrix/rooms` still exists and creates an **unencrypted**
room inside the Space — useful when you would rather not depend on key sharing at
all, and the only option for reading anything posted before the bot arrived. The
settings page offers it as a button when adding a Matrix source.

There is no backfill: the first `/sync` keeps only its cursor. That cursor is
persisted, so a restart resumes rather than replaying.

| Environment variable    | Default                                   | Description                                                    |
| ----------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| `TAK_STREAM_HOST`       | _(empty)_                                 | TAK Server's CoT streaming host. Setting it enables TAK ingest |
| `TAK_STREAM_PORT`       | `8089`                                    | TAK's TLS CoT input port                                       |
| `TAK_API_PORT`          | `8443`                                    | TAK's Marti REST port, used to read Data Sync feeds            |
| `TAK_TLS_SERVERNAME`    | _(empty)_                                 | SNI name, when it differs from the host                        |
| `TAK_CLIENT_CERT_PATH`  | `/data/persistent/public/mtlsclient.pem`  | Our RM-issued client certificate                               |
| `TAK_CLIENT_KEY_PATH`   | `/data/persistent/private/mtlsclient.key` | Its private key                                                |
| `TAK_CA_PATH`           | `/ca_public/ca_chain.pem`                 | CA bundle for verifying peers                                  |
| `MATRIX_HOMESERVER_URL` | _(empty)_                                 | Internal Synapse URL. Setting it enables Matrix ingest         |
| `MATRIX_PRODUCT_NAME`   | `matrix`                                  | RM product name to request interop with                        |

## Who can read what

**Every authenticated user can read every event.** `GET /api/v1/events` has no
per-room, per-source or per-user scoping, and that includes Matrix messages the
ingest bot decrypted out of rooms the reader is not a member of, and the raw CoT
`<detail>` of the whole deployment's tracks.

This is a deliberate decision for a single-unit deployment, where everyone with
a certificate is inside the same operational picture and the feed exists to be
that shared picture. It is written down here because it is not obvious from the
code, and because two consequences follow from it:

- Adding a Matrix ingest source downgrades that room's end-to-end encryption
  guarantee to "whatever this application's access control is". Synapse would
  refuse a non-member; this will not. The room-creation flow sets a topic saying
  so, but a room an admin points the bot at afterwards gets no such notice — the
  members of that room should be told out of band.
- The bot's crypto store (`/data/persistent/matrix-crypto`) holds every megolm
  session ever shared with it. Anyone who obtains that volume — a backup, a
  snapshot, a captured node — can decrypt the full history of every ingested
  room offline, indefinitely. Before this feature, compromising one operator's
  handset got that operator's keys; now compromising this container gets the
  keys of every room it was pointed at. Protect and retain the volume
  accordingly.

ponytail: if a deployment ever needs per-room or per-unit read scoping, that is
a data-model change (a scope on the event, resolved against the caller's
identity on every read), and it is much cheaper before there is production data
in `events` than after. Decide it before accreditation, not after.

## Alerts

An alert is a filter that raises its hand instead of narrowing a list. Rules are
configured per event-feed widget, alongside that widget's views, and they fire
independently of which view happens to be showing — an alert is about the
deployment, not about what someone is looking at.

A raised alert does two things:

1. outlines and pulses the widget that watches for it, then holds the outline
   until it is clicked away — a permanently blinking tile stops being read as new;
2. unfolds the **alerts control**, which lists alerts raised by _every_ board's
   rules and is where an operator acknowledges them. On desktop that is a bell in
   the app header; on a phone it is an entry in the dashboard's bottom bar, whose
   list opens as a full-width drawer — a header popover is wider than a phone
   screen, and the acknowledge column ended up outside the viewport.

Both happen where the operator is already looking. There is deliberately no
corner toast: a notification to be dismissed somewhere else is one more thing to
miss. The bell lives in the header rather than on a board because the header is
the one thing on screen on every page, and it costs no tile from the board the
alert is about.

The list unfolds only for an alert arriving while someone is watching, never for
the backlog it loads with — otherwise every page load would fling it open over
alerts dealt with yesterday. Tapping the control opens and closes it at will.

On a phone a new alert updates the count but does **not** open the drawer or
switch the screen: one widget has the whole screen there, and taking it over
would unmount whatever is in it — including a half-typed report in the entry
form. The badge is the signal; the tap is the operator's.

There is also an **Alerts widget** for boards, showing the same list. It is not
in any template: it exists for a wall display where the list should be
permanently readable rather than behind a control nobody is standing next to.

Acknowledging writes an `alert-dismissed` event carrying `alertId` and `eventId`,
so who cleared what is in the same log as everything else rather than in a
private flag nobody can audit.

Nothing about an alert is stored server-side and no alert row is ever written: an
alert is the pairing of a rule with an event, derived on demand from the shared
event stream. Two consequences worth knowing:

- Editing a rule rewrites history — yesterday's alerts are whatever today's
  rules match. That is the right trade while a rule is a dashboard setting; if an
  alert has to become a matter of record ("this fired, at this time, under this
  rule"), it needs a server-side evaluator writing its own event.
- The Alerts widget checks the rules against the last N events (its `lookback`,
  200 by default) rather than the whole log, because rules are a union and the
  events API filters by AND. The widget's footer states the number.

Acknowledged alerts stay on the list, greyed and struck through. Nothing can be
tapped out of the view: acknowledging says someone has seen it, and a list you
can empty cannot be read as "this is what happened".

## Tech stack

Hono · `@hono/zod-openapi` · Drizzle · Postgres + PostGIS · Zod · pino · OpenTelemetry · varlock · Biome · Vitest · React · Vite · TanStack Router · Mantine

## Docs

- [LICENSE](./LICENSE)
