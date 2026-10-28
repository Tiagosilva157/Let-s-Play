-- Código de acesso (OTP) passa a ir por e-mail, nunca mais pelo WhatsApp.
-- Guardamos no pedido o e-mail (e o nome, para quem é novo) informados na tela:
-- só viram cadastro depois que o código é validado.
alter table otp_codes add column if not exists email text;
alter table otp_codes add column if not exists name text;
