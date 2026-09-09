-- ============================================================
-- 0014 — Forma de pagamento da cobrança
--   asaas_pix   → pago pelo Pix do Asaas (webhook)
--   cash        → admin acusou pagamento em dinheiro
--   pix_manual  → admin acusou pagamento via Pix fora do Asaas
-- ============================================================
alter table charges add column if not exists payment_method text
  check (payment_method in ('asaas_pix','cash','pix_manual'));
alter table charges add column if not exists paid_at timestamptz;
