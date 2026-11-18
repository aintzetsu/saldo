# Saldo
A personal finance tracker for bank accounts, e-wallets, and cash. Create an account, keep the generated sign-in key in a password manager, and use it to access your ledger across devices. The public application starts each new account with an empty ledger.

## Deployment
Import this repository into Vercel with the Other framework preset. Connect a private Vercel Blob store to the project for authenticated server-side storage. The static application is served from public and the Node function is in api/account.js. Each ledger is scoped to its signed-in session. Conditional writes prevent stale tabs from overwriting newer changes.

The account key is the only sign-in credential. Anyone with it can access the ledger. There is no account recovery. Existing browser-only Saldo ledgers on other origins are separate. Transactions are entered manually or imported from CSV.
