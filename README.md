# Admin panel: Quantly NFT Launchpad & Marketplace (QMS)

A separate app from the public website. It is built and deployed on its own, so none of its code ships to
marketplace users. It talks to the same backend API, which only answers `/api/admin/*` requests coming from
this site's address (`ADMIN_ORIGINS`) **and** from a wallet that has an admin role.

## Run locally (PowerShell)

```powershell
cd admin
npm install
Copy-Item .env.example .env   # VITE_API_URL=http://localhost:8080
npm run dev                   # http://localhost:5174
```

Backend `.env` must include `ADMIN_ORIGINS=http://localhost:5174` (and your production admin URL).

## Deploy on Netlify (its own site)

1. New site from the same repo: base directory `admin`, build `npm run build`, publish `admin/dist`.
2. Environment (see `.env.example`): `VITE_API_URL`, `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_MARKET_ADDRESS`,
   `VITE_FACTORY_ADDRESSES`, `VITE_FEE_VAULT_ADDRESS`, `VITE_SAFE_ADDRESS`, `VITE_SITE_URL`. A production build stops if a
   security pin is missing; without `VITE_SAFE_ADDRESS` the Multisig and Treasury pages stay read-only.
3. Use a hard-to-guess subdomain. Don't link it from the public site.
4. Add its URL to the backend's `ADMIN_ORIGINS` and redeploy the API.
5. Extra layer (recommended): Netlify **Site protection → Password** (Pro plan), or Cloudflare Access in front of it.

`netlify.toml` already sets a strict CSP, no-index, no caching of pages, and anti-framing headers.

The panel uses the same purple and white design as the website; the moon / sun button in the top bar switches to
the dark theme and remembers the choice on the device.

## Sections

| Section | What it does | Role |
|---|---|---|
| Overview | Marketplace / launchpad / Safe / FeeVault status, sales chart, what needs attention, recent admin activity | support |
| Treasury | FeeVault and Safe balances, fees per day, withdraw from the FeeVault, send from the Safe, withdrawal status and on-chain history | admin |
| Multisig | Safe owners, threshold, security checks, transaction queue (sign / execute), history (also actions done with `safe-tx.ps1`), emergency pause, owner changes | admin |
| Collections | Search and filter, verified / featured / hidden / mint page, block or enable trading, edit details, extra images (up to 3) and About page, refresh, remove | admin |
| Import | Bring existing ERC-721 collections on the network into Quantly | admin |
| Contracts & fees | Trading fee, mint fee, pause and resume, guardian | admin |
| Support | User tickets | support |
| API keys | Developer key requests: approve with limits, reject with a reason, pause, resume, revoke, tier and note, 30-day usage (keys are never visible here, only their prefix) | admin |
| Activity log | Every admin action, filters, search, CSV export | admin |
| Site settings, Team, Network | Footer links, who can sign in, chain and contracts | admin / owner |

## How the multisig works here (QMS has no Safe web app)

The Safe contracts are not deployed on QMS Testnet yet, so this section applies once you deploy Safe v1.3.0 there and
transfer ownership to it. Until then, on-chain buttons send the transaction directly from the owner wallet.

1. Any admin creates a **proposal** (for example "Withdraw all QMS from the FeeVault to the Safe"). Nothing moves yet.
2. Each Safe owner signs in with their owner wallet and presses **Sign**. The wallet shows a `SafeTx` signature request with
   the Safe, target, data and nonce. Signing costs no gas.
3. When enough owners signed, any owner presses **Execute** (the last owner can press **Sign & execute**: sending the
   transaction counts as their approval). The Safe checks every signature again on-chain.

Before anything is signed or executed, the browser decodes the call itself, re-encodes it, and checks that its own hash, the
proposal's hash and the Safe's `getTransactionHash` all match. Only the listed actions on the pinned marketplace contracts can be
proposed; delegatecall, arbitrary contracts, threshold 1 and non-WQMS token withdrawals are refused by both the browser and the API.
A signed proposal can't be deleted (its signatures stay valid on-chain): use **Reject on-chain**, a no-op at the same nonce.

Owner wallets need panel access to sign: add them in Team, or press **Give access** next to an owner in Multisig.

## Who can sign in

- **Root owners:** wallets in the backend's `ADMIN_ADDRESSES`.
- **Everyone else:** wallets added in the Team tab or with `db/03_first_admin.sql`.

The role is checked on every request, and admin actions need a wallet sign-in from the last 12 hours.
