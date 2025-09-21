-- Enable UUID generation
create extension if not exists pgcrypto;

-- Chat messages
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_session_created_idx on public.chat_messages (session_id, created_at);

-- Carts summary
create table if not exists public.carts (
  session_id uuid primary key,
  subtotal_cents integer not null default 0,
  discount_cents integer not null default 0,
  total_cents integer not null default 0,
  voucher_code text,
  updated_at timestamptz not null default now()
);

-- Cart lines
create table if not exists public.cart_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  product_name text not null,
  unit_price_cents integer not null,
  qty integer not null,
  image_url text,
  created_at timestamptz not null default now()
);
create index if not exists cart_lines_session_idx on public.cart_lines (session_id);

-- Tickets
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,
  user_email text,
  category text,
  subject text,
  message text,
  priority text,
  created_at timestamptz not null default now()
);

-- Vouchers
create table if not exists public.vouchers (
  code text primary key,
  type text not null check (type in ('percent','fixed','free_ship')),
  value integer not null default 0,
  min_subtotal_cents integer not null default 0,
  applies_to text not null default '*',
  expires_at timestamptz,
  active boolean not null default true
);


