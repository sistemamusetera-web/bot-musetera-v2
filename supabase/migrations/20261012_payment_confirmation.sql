-- Campos necessários para confirmar PIX e cartão pelo webhook do Mercado Pago.
alter table public.pix_charges
  add column if not exists external_reference text,
  add column if not exists payment_method text not null default 'pix',
  add column if not exists confirmation_sent_at timestamptz;

create unique index if not exists pix_charges_external_reference_uidx
  on public.pix_charges (external_reference)
  where external_reference is not null;

create index if not exists pix_charges_payment_id_idx
  on public.pix_charges (payment_id);
