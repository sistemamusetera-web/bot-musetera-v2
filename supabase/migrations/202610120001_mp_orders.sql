-- Apply this migration in the Supabase SQL Editor before deploying the payment webhook.
-- The table stores a single record for both PIX and card checkouts.
create table if not exists public.mp_orders (
  id uuid primary key default gen_random_uuid(),
  external_reference text not null unique,
  conversation_id uuid not null,
  phone text not null,
  instance_name text not null,
  plan_id text not null check (plan_id in ('30d', '6m', '1y')),
  plan_label text not null,
  amount numeric(10,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('pix', 'card')),
  payment_id text unique,
  preference_id text,
  qr_code text,
  qr_code_base64 text,
  expires_at timestamptz,
  status text not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mp_orders_conversation_id_idx
  on public.mp_orders (conversation_id);
create index if not exists mp_orders_status_idx
  on public.mp_orders (status);

alter table public.mp_orders enable row level security;
