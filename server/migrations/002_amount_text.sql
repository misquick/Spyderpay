-- Amounts in ETH need more than 2 decimals; keep the merchant's amount exactly as normalized.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_amount_check;
ALTER TABLE invoices ALTER COLUMN amount TYPE text USING amount::text;
