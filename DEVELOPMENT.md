# Running and deploying the API

Use Node **24.x**, Express 5, Mongoose 9, and MongoDB Atlas. Runtime dependencies
and their locked versions are unchanged.

## Local development

1. Install the dependencies with `npm ci`.
2. Keep `MONGODB_URI` in your local `.env` file. It must specify the intended
   application database. The file is ignored by Git.
3. Run `npm start`, or `npm run dev` for automatic restarts.

The default local port is `3000`; `PORT` overrides it. The application waits for
MongoDB connectivity and required indexes before accepting requests. Index
initialization does not delete records or remove existing indexes. Existing
duplicate emails must be resolved before the unique email index can be created.

`GET /api` returns readiness: `200` with
`{"message":"OK","data":{"status":"ready"}}`, or `503` when the database is
unavailable. It never exposes the connection URI or `TOKEN`.

## API behavior

Both `/api/users` and `/api/tasks` support GET and POST. Their `/:id` routes
support GET, PUT, and DELETE. The assignment README defines the resource fields
and relationship rules.

- Success uses `200`, or `201` for creation, with `{ "message": "...", "data": ... }`.
- DELETE returns `200` and the deleted resource's `_id` in `data`.
- Errors use the same envelope with `data: null`; missing resources use `404`,
  invalid input uses `400`, and unexpected failures use `500`.
- PUT replaces all writable fields. Missing optional fields receive defaults;
  `_id` and `dateCreated` are server-managed and cannot be replaced.
- `where`, `sort`, `select`, `skip`, `limit`, and `count` are JSON-encoded query
  parameters on collection GET routes. Filtering and pagination run in MongoDB.
- Tasks default to 100 results; users are unlimited. Explicit `limit=0` means
  unlimited. `count=true` counts all matches before pagination.
- Single-resource GET routes apply only `select`; other parameters are ignored.
- JSON field types are strict. URL-encoded bodies also accept boolean strings
  and pending-task arrays expressed with bracket syntax or as a JSON array.
- User emails retain their supplied spelling and use exact-value uniqueness.
- OPTIONS preflight returns bodyless `204` with the configured CORS headers.

When errors overlap, a missing URL resource takes precedence, followed by
invalid field values, followed by missing body references. A completed task in
`pendingTasks` therefore produces `400` even if another requested task is missing.

## Transactions and concurrency

Each mutation and its related writes share one database transaction, using
snapshot reads and majority writes. Every database operation receives the same
session. The driver retries transient failures and uncertain commit results
within a 15-second transaction budget.

Operations involving an existing user increment an internal version on that
user. User replacement and deletion coordinate through the same document. This
prevents races between task assignment and user rename/deletion, including
completed tasks that do not appear in `pendingTasks`. Affected users are touched
in ID order. The internal version is not part of API responses.

Validation failures and aborted transactions leave resource data unchanged.
An HTTP disconnect or unresolved commit acknowledgment can leave a client
uncertain whether a transaction committed; the API does not provide an
idempotency-key contract. Check resource state before retrying an uncertain POST.

SIGTERM and SIGINT stop new traffic, drain requests, and close MongoDB. Shutdown
has a 20-second deadline.

## Tests

Run parser/validation and disconnected lifecycle checks:

```sh
npm test
```

Database tests require a replica set or transaction-capable Atlas deployment:

```sh
TEST_MONGODB_URI='mongodb://127.0.0.1:27028/?replicaSet=mp3test' npm test
```

Supply your own test deployment URI through the environment when using Atlas.
The test harness always overrides the database name with a generated
`mp3_test_<random-id>` name. It deletes only that generated database after the
run; it does not use or clean the database named in the URI. The database user
must have permission to create and remove this temporary database. Without
`TEST_MONGODB_URI`, database integration and connected lifecycle tests are
explicitly skipped.

The tests cover HTTP contracts, projections and queries, replacement defaults,
relationship changes, rollback after intermediate writes, transient transaction
retry, duplicate-email races, competing owners, rename/deletion races, and
graceful server shutdown. Relationship invariants are checked directly in MongoDB.

## Existing Render service

Deployment URL: <https://cs409-mp3-y2qt.onrender.com>.

Configure the existing service with:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Node version | 24.x; verify any `NODE_VERSION` override also selects 24 |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health-check path | `/api` |
| Environment | `MONGODB_URI`, `NODE_ENV=production` |

Render supplies `PORT`; the server binds to `0.0.0.0`. Keep database credentials
in Render's environment settings. Atlas network access must permit the service
as required by the assignment. Confirm the linked Git branch in Render before
deploying; the local checkout currently uses `main`.

After deploying, verify `/api`, exercise the resource routes, and run
`npm run submit`. The submission script already targets the URL above;
`AUTOGRADER_URL` is unchanged. The course grader creates test records in the
application database and attempts to delete them afterward. Running the grader
is a self-check, not the course submission.

## References and course disclosure

Implementation references:

- [Mongoose transactions](https://mongoosejs.com/docs/transactions.html)
- [MongoDB transaction production considerations](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/)
- [MongoDB Node.js driver transactions](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/)
- [MongoDB driver session API](https://mongodb.github.io/node-mongodb-native/7.7/classes/ClientSession.html)
- [Render Node version selection](https://render.com/docs/node-version)
- [Render web services](https://render.com/docs/web-services)
- [Render health checks](https://render.com/docs/health-checks)

The README requires disclosure of referenced sources. For LLM-generated code,
retain and submit the chat logs and complete the LLM survey in the grading form.
