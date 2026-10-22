# myPluggy MCP

[Português](README.md) · **English**

A remote, **read-only** [MCP](https://modelcontextprotocol.io) server that connects [Claude](https://claude.ai) to your Brazilian bank accounts through [Pluggy](https://pluggy.ai) (Open Finance Brasil). You host it yourself, add it to claude.ai as a custom connector, and ask things like:

> "How much did I spend on restaurants in September?"
> "When is my credit card bill due, and what is the minimum payment?"
> "List this month's transactions above R$ 500."

> [!IMPORTANT]
> Personal, unofficial project, not affiliated with Pluggy or Anthropic. Everyone hosts their own instance with their own credentials; no data goes anywhere other than Pluggy and Claude.

Tool names and responses are in Portuguese because the data (Brazilian banks, categories) is. Claude handles that fine in any language.

## How it works

```
claude.ai ──HTTPS + OAuth 2.1──▶ Caddy/nginx ──▶ myPluggy MCP ──API──▶ Pluggy ──Open Finance──▶ your banks
                                                  (Docker)
```

- **Transport:** Streamable HTTP (`POST /mcp`), stateless.
- **Auth:** OAuth 2.1 with PKCE and dynamic client registration, which is what claude.ai expects from a custom connector. You approve access with a **passkey** (Face ID, Touch ID, Windows Hello or a security key). There is no password.
- **Read-only:** no tool writes data, makes payments or moves money.

## Tools

| Tool | What it does | Parameters |
|---|---|---|
| `listar_contas` | Accounts and credit cards with current balance, limit and bill dates | — |
| `listar_transacoes` | Transactions in a date range, newest first (negative = outflow) | `de`, `ate` (YYYY-MM-DD), `conta_id?`, `limite?` |
| `resumo_por_categoria` | Spending grouped by category, with percentages | `de`, `ate`, `conta_id?` |
| `listar_faturas_cartao` | Open bill (closing date, due date, minimum) and recent closed bills | `conta_id?`, `quantidade?` |
| `listar_investimentos` | Investment positions, when the bank provides them | — |

The category summary skips transfers between your own accounts, bill payments and investment moves, so the same money isn't counted twice.

## Requirements

- A [Pluggy](https://dashboard.pluggy.ai) account with an application (gives you `CLIENT_ID` and `CLIENT_SECRET`).
- Banks connected through **[Meu Pluggy](https://meu.pluggy.ai)**, Pluggy's personal-use path: free, non-commercial, with a connection limit. See the [official guide](https://docs.pluggy.ai/en/docs/guides/meu-pluggy-personal-use).
- A Linux server with Docker and Docker Compose, reachable from the internet on ports 80 and 443.
- A domain or subdomain pointing to the server. If you don't have one, [sslip.io](https://sslip.io) works: `mcp.203-0-113-10.sslip.io` resolves to `203.0.113.10` (use your server's IP).

## Setup

### 1. Pluggy

1. At [meu.pluggy.ai](https://meu.pluggy.ai), sign up and connect your banks.
2. Sign in to the [Pluggy Dashboard](https://dashboard.pluggy.ai) with the same account, open *Applications → your application* and copy the **Client ID** and **Client Secret**.
3. In the *Demo* tab, click **Connect Account** and pick the **MeuPluggy** connector in the widget (not your bank, not the Sandbox). Each Meu Pluggy bank becomes an **item** in the application.
4. Copy the item IDs from *Demo → Connected Items*. Pluggy's API doesn't list items for regular applications, so the IDs go in the config.

### 2. Configure

On the server:

```bash
git clone https://github.com/Gabrielhsb/mypluggy-MCP.git
cd mypluggy-MCP
cp .env.example .env
openssl rand -base64 32   # use the output as SETUP_TOKEN
nano .env                 # fill in the variables
```

| Variable | Description |
|---|---|
| `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` | Pluggy application credentials |
| `PLUGGY_ITEM_IDS` | Comma-separated item IDs |
| `PUBLIC_URL` | Public URL, e.g. `https://mcp.yourdomain.com` |
| `SETUP_TOKEN` | Secret used only to register the first passkey (at least 24 characters) |
| `MCP_DOMAIN` | Domain Caddy requests a certificate for (option A only) |

Check that the credentials and items work. The diagnostic prints counts and field names only, never values:

```bash
docker compose run --rm mcp node dist/doctor.js
```

### 3. Start the server

**Option A, fresh server (Caddy with automatic HTTPS):**

```bash
docker compose --profile caddy up -d --build
```

**Option B, server already running nginx on ports 80/443:**

```bash
docker compose up -d --build   # MCP listens on 127.0.0.1:3000 only
```

Then set up the nginx site from [`deploy/nginx.conf.example`](deploy/nginx.conf.example) and get a certificate with `certbot --nginx`. If port 3000 is taken, set `MCP_HOST_PORT` in `.env` and update `proxy_pass`.

**Firewall:** keep only ports 22, 80 and 443 open.

```bash
sudo ufw allow 22,80,443/tcp && sudo ufw enable
```

On clouds like Oracle, AWS and GCP, open the same ports in the instance's network rules too (security list or security group).

Check: `https://mcp.yourdomain.com/health` should return `{"ok":true}`.

### 4. Connect in claude.ai

1. Go to **Settings → Connectors** and click **Add custom connector**.
2. Enter `https://mcp.yourdomain.com/mcp` as the URL.
3. Click **Connect**. Your server's authorization page opens:
   - **First time:** enter the `SETUP_TOKEN` and register your passkey.
   - **After that:** just confirm with the passkey.
4. Done. The tools show up in the conversation's tools menu.

## Security

- Pluggy credentials live only in `.env`, which is in `.gitignore` and `.dockerignore`.
- Access tokens last 1 hour and refresh tokens 30 days, both HMAC-signed. To revoke all of them, delete `tokenSecret` from `/data/state.json` (volume `mcp-data`) and restart the container.
- Registering a passkey requires the `SETUP_TOKEN`. After 5 failures in 15 minutes, further attempts are blocked.
- Rate limits: 60 req/min on `/mcp`, 30 req/min on passkey routes, plus the SDK's own limits on OAuth routes.
- Logs record only method, path, status, duration and tool name. Query strings, tokens and bank data are never logged.
- The authorization page sends a strict CSP, `X-Frame-Options: DENY` and `no-store`.
- The container runs as an unprivileged user and is exposed only on `127.0.0.1`; the proxy is what faces the internet.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Limitations

- Pluggy doesn't provide the **open bill** amount, only its dates and minimum payment. Closed bills come complete. For a partial total, ask Claude to sum the card's transactions since the last closing date.
- Meu Pluggy items are refreshed by Pluggy about once a day.
- One owner per instance: the passkey grants access to every configured item.

## Development

Requires Node.js 20.6 or later.

```bash
npm install
cp .env.example .env   # PUBLIC_URL=http://localhost:3000 (passkeys work on localhost)
npm run doctor         # check credentials and items
npm run dev            # server with reload
npm test               # tests
npm run lint           # ESLint + type check
npm run build          # compile to dist/
```

To test without claude.ai, point the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) at `http://localhost:3000/mcp`.

## License

[MIT](LICENSE)
