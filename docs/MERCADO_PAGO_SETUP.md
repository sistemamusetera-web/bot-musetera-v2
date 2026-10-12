# Mercado Pago + Supabase setup

## Required environment variables

Configure these in the server deployment (never in the frontend):

- `PUBLIC_APP_URL`: the public **HTTPS URL of this Node/Express server**, without a trailing slash. It must not be the portal URL unless the portal also serves these API routes.
- `MERCADOPAGO_ACCESS_TOKEN`: Mercado Pago access token.
- `MERCADOPAGO_WEBHOOK_SECRET`: the webhook signing secret shown in Mercado Pago's webhook configuration.
- `SUPABASE_URL`: `https://tvmffyfjdfwywsufjllv.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY`: the project's service-role key. Keep it server-side and private.

The two payment notification paths registered by the server are:

- `POST /api/public/mp-webhook` (PIX)
- `POST /api/webhooks/mercadopago` (card checkout)

Both verify Mercado Pago's `x-signature` and `x-request-id`, fetch the payment directly from Mercado Pago, and compare the external reference, amount, and currency with the stored order before marking it approved.

## Database migration

Before deploying the code, open the Supabase project SQL Editor and execute the contents of:

`supabase/migrations/202610120001_mp_orders.sql`

The server persists each PIX/card order in `public.mp_orders` before sending the checkout link. The migration enables RLS; server operations use the service-role key.

## What payment confirmation does

On a verified approval, the order is marked `approved` and the bot sends a confirmation message. Duplicate notifications do not intentionally send the same confirmation again; failed delivery can be retried by Mercado Pago.

This bot repository does not contain the portal's account/subscription schema or a documented account identifier that links a WhatsApp conversation to a portal user. Therefore, the webhook deliberately does **not** grant portal access automatically. To implement entitlement activation safely, the portal repository must provide its authoritative subscription table/API and account-linking contract. Do not treat an approved payment order as proof that a portal account has been activated.

## Checks

The CI workflow runs TypeScript checking, focused unit tests, and the production build. The live integration tests requiring real Supabase/Evolution/Mercado Pago credentials are not run in CI.
