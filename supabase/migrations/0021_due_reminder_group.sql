-- Lembrete de mensalidade por turma:
--   due_reminder_channel: individual = Pix no privado de cada mensalista (como era)
--                         group      = UMA mensagem no grupo com o link da turma (nada no privado)
--                         off        = sem lembrete automático
--   due_reminder_days: em quais dias antes do vencimento lembrar (0 = no próprio dia)
alter table teams add column if not exists due_reminder_channel text not null default 'individual'
  check (due_reminder_channel in ('individual','group','off'));
alter table teams add column if not exists due_reminder_days int[] not null default '{5,0}';
