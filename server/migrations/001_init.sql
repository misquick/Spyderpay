CREATE TABLE merchants (
  id              uuid PRIMARY KEY,
  name            text        NOT NULL,
  payout_address  text        NOT NULL,
  webhook_url     text,
  webhook_secret  text        NOT NULL,
  api_key_hash    text        NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id              uuid PRIMARY KEY,
  merchant_id     uuid        NOT NULL REFERENCES merchants (id),
  status          text        NOT NULL CHECK (status IN ('pending', 'confirming', 'paid', 'expired', 'cancelled')),
  chain_id        integer     NOT NULL,
  token_address   text        NOT NULL,
  token_symbol    text        NOT NULL,
  token_decimals  integer     NOT NULL,
  pay_to          text        NOT NULL,
  amount          numeric(20, 2) NOT NULL CHECK (amount > 0),
  amount_units    numeric(78, 0) NOT NULL CHECK (amount_units > 0),
  description     text,
  order_id        text,
  redirect_url    text,
  tx_hash         text,
  log_index       integer,
  block_number    bigint,
  block_hash      text,
  payer_address   text,
  confirmations   integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  paid_at         timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Two open invoices for the same address never expect the same exact amount:
-- this is what makes matching a transfer to an invoice unambiguous.
CREATE UNIQUE INDEX invoices_open_amount_uq
  ON invoices (chain_id, token_address, pay_to, amount_units)
  WHERE status IN ('pending', 'confirming');

-- One on-chain transfer can pay at most one invoice.
CREATE UNIQUE INDEX invoices_payment_uq
  ON invoices (chain_id, tx_hash, log_index)
  WHERE tx_hash IS NOT NULL;

CREATE INDEX invoices_merchant_idx ON invoices (merchant_id, created_at DESC);
CREATE INDEX invoices_open_idx ON invoices (chain_id, status) WHERE status IN ('pending', 'confirming');

-- Transactional outbox for webhooks.
CREATE TABLE webhook_deliveries (
  id              uuid PRIMARY KEY,
  merchant_id     uuid        NOT NULL REFERENCES merchants (id),
  invoice_id      uuid        NOT NULL REFERENCES invoices (id),
  event           text        NOT NULL,
  url             text        NOT NULL,
  payload         jsonb       NOT NULL,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts        integer     NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';

-- How far the scanner has read each chain.
CREATE TABLE chain_cursors (
  chain_id      integer     PRIMARY KEY,
  block_number  bigint      NOT NULL,
  block_time    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
