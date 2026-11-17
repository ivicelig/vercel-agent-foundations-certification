# Ship It Shop: store agents

A Next.js storefront for the Vercel Swag Store with two AI agents built on the
AI SDK, Vercel Workflow and Vercel Sandbox:

- **Shopping agent**: a chat in the storefront (robot icon, top right) that
  helps customers find products, inspect an item and start a return.
- **Store admin agent**: a separate chat at `/admin` that helps employees
  investigate tickets, returns, inventory and sales, computes results in a
  Vercel Sandbox and remembers context between conversations.

The storefront, cart and admin login are the starter's and still work as before.

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS v4, shadcn/ui
- AI SDK 7 (`ai`, `@ai-sdk/react`), AI Elements for the chat UI
- `@ai-sdk/workflow` (`WorkflowAgent`) on Workflow SDK 5 (`workflow`) for durable runs
- `@vercel/sandbox` for isolated command execution and persistent memory
- Model access through Vercel AI Gateway (`lib/model.ts`)
- pnpm

## Setup

Prerequisites: Node.js 22.19 or newer, [pnpm](https://pnpm.io), the
[Vercel CLI](https://vercel.com/docs/cli) and a Vercel project linked to this repo.

```bash
pnpm install
vercel login
vercel link                      # choose the project created for this repo
vercel env pull .env.local       # writes the project env vars and an OIDC token
pnpm dev
```

Open http://localhost:3000. The storefront needs products to load from the
store API; if they do not, check `BYPASS_SECRET` and `API_BASE_URL`.

For the admin chat, open `/admin` and sign in with the demo password given in
the assignment (it is defined in `lib/admin-auth.ts`; it is a demo gate, not
real authentication).

The OIDC token written by `vercel env pull` expires after about 12 hours. If
model or sandbox calls start failing with an authentication error, pull again.
You can use an AI Gateway API key for model calls instead (see below).

## Environment variables

Names and purposes only. See `.env.example`. `.env.local` is gitignored.

| Variable | Required | Purpose |
| --- | --- | --- |
| `BYPASS_SECRET` | Yes | Deployment-protection bypass secret for the store API. Used server-side only, never returned in a tool result or chat message. |
| `API_BASE_URL` | No | Store API base URL, ending in `/api`. Defaults to the public Swag Store API. |
| `VERCEL_OIDC_TOKEN` | Local dev | Authenticates AI Gateway and Vercel Sandbox. Written by `vercel env pull`. Not needed on Vercel, where the deployment provides it. |
| `AI_GATEWAY_API_KEY` | Optional | Used for model calls instead of the OIDC token. Sandbox still needs the OIDC token locally. |
| `NEXT_PUBLIC_SITE_URL` | No | Public site URL for metadata. Defaults to `http://localhost:3000`. |

No secret is prefixed `NEXT_PUBLIC_`, and none is read by a client component.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Development server on http://localhost:3000 |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |

`pnpm lint` is wired to `eslint .`, but ESLint is not installed in the starter,
so it fails until a linter is added. There is no test framework.

## Shopping agent

Route: `POST /api/chat`. Reconnect: `GET /api/chat/{runId}/stream`.

Tools (`lib/shop-tools.ts`), all with Zod-validated input:

| Tool | What it does |
| --- | --- |
| `searchProducts` | Search the catalog by text and category, or browse. Paginated. |
| `getAllCategories` | Read the current categories from the store API. The agent is told to use this before filtering, so no category list is hard-coded. |
| `getProductDetails` | One product with description, price, images, tags and live stock. |
| `returnOrder` | Starts the return workflow for an order and a reason. |

**Presentation.** Results render as components inside the conversation
(`components/chat/chat-product-cards.tsx`): a product grid with images,
formatted prices and links to the existing `/products/:id` pages, a product
detail card with a stock badge, a category list, and a return status card.
Running tools show plain-language progress ("Searching the catalog…"); empty
results and failures have their own messages.

**Failures are never turned into success.** Each tool returns either `ok: true`
with data or `ok: false` with a kind (`not_found`, `invalid_input`,
`not_eligible`, `unavailable`) and a message (`lib/tool-result.ts`). The agent
is instructed to report failures and not to invent results. If only the stock
service fails, product details still return and say stock is unavailable.

**Returns** (`lib/workflows/return-flow.ts`). The return runs as its own
workflow so the chat does not block on it. `returnOrder` checks that the order
exists and is `fulfilled`, starts the workflow and answers right away. The
workflow then runs four steps: look up the order, notify the customer,
pre-authorize the refund, file the return. Each step has its own retry budget.
The Workflow runtime records every completed step, so retrying a failed later
step does not repeat an earlier one. The run is started with a hook token
`return:{orderId}` kept for one day, so asking twice does not start a second
return. Permanent API errors (4xx) fail the step without retrying; network
errors, 429 and 5xx are retried.

The customer notification (`notifyReturnInProcess` in `lib/api.ts`) is the
starter's logging stub. There is no email provider behind it.

## Store admin agent

Routes: `POST /admin/api/chat`, reconnect `GET /admin/api/chat/{runId}/stream`.

Tools (`lib/admin-tools.ts`). Store data access is read-only; nothing in the
tool set can change inventory, tickets or refunds.

| Tool | What it does |
| --- | --- |
| `getSupportTickets` | Tickets with date range, status, priority, category, assignee and limit filters. |
| `getReturnsHistory` | Returns with date range, status, decision and limit filters; includes refund and order summary. |
| `getInventoryStock` | Stock with product, low-stock and in-stock filters; paginated. |
| `getSalesAnalytics` | Sales by product for a date range, optionally for one product. |
| `searchProducts`, `getAllCategories` | Catalog context to identify products, shared with the shopping agent. |
| `bash` | Runs a command in the admin sandbox. |
| `saveMemory` | Appends a note to the memory file. |

**Why the sandbox does the arithmetic.** Each data tool saves its full result
as a JSON file in the sandbox and returns only a short preview, row counts and
the file path. The agent is instructed to compute every total, rate and join
with `bash` (Python is available) over those files. For example, return rate
per product is fetched as two datasets and joined in the sandbox on `productId`.
The chat shows each command and its output, with running and failed states.

**The sandbox** (`lib/admin-sandbox.ts`) is one named persistent sandbox,
`ship-it-shop-admin`, used for both computation and memory:

- network policy `deny-all`: code the model writes cannot reach the internet
- no credentials are passed in (the only variable set is `ADMIN_COMMAND`, which
  carries the command text), so no secret exists inside the VM
- 1 vCPU; commands are limited to 60 seconds by `timeout` inside the VM, with
  the SDK's `timeoutMs` as a backstop; output is capped at 8,000 characters
- only the filesystem persists between sessions; the sandbox resumes on the
  next command

**Memory.** The memory file is `/vercel/sandbox/memory/MEMORY.md` in that
sandbox. At the start of every admin run the workflow reads it and puts it into
the agent's instructions as clearly delimited background data, not as
instructions. A missing file means a fresh start; an unreachable sandbox is
reported to the agent as "memory unavailable". `saveMemory` appends one short
dated note, refuses notes that look like credentials, and the file is capped at
20,000 characters. Store data is deliberately not saved, so it is always
fetched fresh.

**Admin-only.** The admin API lives under `/admin` on purpose: the login
cookie is scoped to `/admin`, so the browser sends it only there, and
`proxy.ts` already guards that path. Each admin route also re-checks the session
on the server (`lib/admin-guard.ts`, constant-time comparison). The starter's
old stub path `/api/admin/chat` is now a plain 404, because a working route
there would have been outside both the cookie scope and the proxy. The
shopping agent has no access to any admin tool, and the customer reconnect
route only serves shopping-chat runs.

Customer emails in ticket data are masked before they reach the model.

## Durable chat

Both chats run as workflows (`lib/workflows/chat-flow.ts`,
`admin-chat-flow.ts`) using `WorkflowAgent`. Model calls and tool executions
are checkpointed; every tool is a `"use step"` function with its own
`maxRetries` (3 for data reads, 2 for sandbox and memory, 4 for return steps).
`lib/step-errors.ts` rethrows transient errors until the last attempt, then
returns a typed failure so the agent can explain it.

Recovery: the response carries an `x-workflow-run-id` header, and the browser
keeps the active run id in `sessionStorage`. If the connection drops or the page
is refreshed, `WorkflowChatTransport` calls the reconnect route, which replays
the run's durable stream and uses `uiStartIndex` to skip the chunks the browser
already has. It does not start a new run. If a model call fails, a visible error
is written into the stream instead of ending it silently.

## Decisions

- **`WorkflowAgent`, not `DurableAgent`.** The installed Workflow docs mark
  `DurableAgent` as deprecated in favour of `WorkflowAgent`.
- **Tool results as data, not strings.** A discriminated `ok` result lets the UI
  and the model tell a real answer from a failure.
- **One sandbox for compute and memory**, as the assignment asks, so saved
  context and analysis live in the same persistent environment.
- **Model: `openai/gpt-5-mini`** through AI Gateway. It supports tool use and
  was the one available on the credit tier used during development. Change the
  single constant in `lib/model.ts` to use another model.
- **Customer chat history lives in the browser.** Messages are sent with each
  request; there is no database.

## Known limitations

- Reconnecting in the middle of a streamed message can drop that partial part
  (the AI SDK documents this); the chat continues normally.
- Datasets written to the sandbox are not cleaned up automatically.
- The admin password is a hard-coded demo constant from the starter.
- `lib/agent.ts` and `lib/tools.ts` are unused starter placeholders.
- The customer notification is a logging stub (see Returns).

## Project structure

```
app/
  (store)/                      storefront routes (starter)
  admin/                        /admin page and login (starter)
    api/chat/                   admin chat route + reconnect route
  api/chat/                     customer chat route + reconnect route
  api/admin/chat/               intentionally returns 404 (see Admin-only)
lib/
  shop-tools.ts, admin-tools.ts tool definitions
  workflows/                    chat, admin chat and return workflows
  admin-sandbox.ts              sandbox, command runner, memory file
  admin-guard.ts                server-side admin check
  tool-result.ts, step-errors.ts typed failures and retry decisions
  model.ts                      model id
  api.ts                        store API client (starter, server-only)
components/
  agent-chat.tsx                storefront chat
  admin-agent-chat.tsx          admin chat
  chat/                         product cards, admin tool views
  ai-elements/                  AI Elements components
proxy.ts                        guards /admin/*
```
