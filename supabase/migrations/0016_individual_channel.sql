-- Canal dos avisos individuais ao jogador:
--   whatsapp = como sempre foi (mensagens no privado)
--   portal   = o jogador vê tudo no link; só o aviso de "subiu da lista de espera" vai no WhatsApp
alter table teams add column if not exists individual_channel text not null default 'whatsapp'
  check (individual_channel in ('whatsapp','portal'));
