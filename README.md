# Saldo
A personal finance tracker for bank accounts, e-wallets, and cash. Create an account with an email verification code or a generated account key. The public application starts each new account with an empty ledger.

## Deployment
Import this repository into Vercel with the Other framework preset. Connect a private Vercel Blob store to the project for authenticated server-side storage. The static application is served from public and the Node function is in api/account.js. Each ledger is scoped to its signed-in session. Conditional writes prevent stale tabs from overwriting newer changes.

Users can sign in with email codes, a passkey, or an account key. Existing users can link a verified email from Account tools while signed in. Anyone with an account key can access its ledger. Email codes use the connected Descope project. Existing browser-only Saldo ledgers on other origins are separate. Transactions are entered manually or imported from CSV.
