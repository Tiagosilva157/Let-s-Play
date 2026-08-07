-- ============================================================
-- 0006 — Status "sending" na fila de mensagens
-- Evita envio duplicado quando o despacho imediato e o cron
-- rodam ao mesmo tempo: a linha é "reservada" antes do envio.
-- ============================================================

alter table message_dispatches drop constraint if exists message_dispatches_status_check;
alter table message_dispatches add constraint message_dispatches_status_check
  check (status in ('queued','sending','sent','failed','skipped','canceled'));
