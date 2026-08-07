// Agendador interno para deploys self-hosted (EasyPanel/Docker), onde não existe
// o cron da Vercel. O próprio servidor dispara as tarefas:
//   - a cada 60s: expirar reservas, abrir/fechar listas, despachar mensagens
//   - 1x por dia (06h): gerar jogos, conciliação Asaas, lembretes
// Na Vercel, defina DISABLE_INTERNAL_CRON=1 e use o vercel.json (crons).

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DISABLE_INTERNAL_CRON === "1") return;
  if (process.env.NODE_ENV !== "production") return; // em dev usamos kickQueueInDev

  // sempre chamamos o próprio processo (localhost): o container pode não
  // resolver/alcançar o próprio domínio público, o que quebraria o agendador
  const base = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const headers = { authorization: `Bearer ${process.env.CRON_SECRET}` };

  const call = (path: string) =>
    fetch(`${base}${path}`, { headers }).catch((e) => console.error(`[cron] ${path} falhou:`, e?.message ?? e));

  // aguarda o servidor subir antes do primeiro tick
  setTimeout(() => {
    call("/api/cron/tick");
    setInterval(() => call("/api/cron/tick"), 60_000);

    let lastDaily = "";
    const daily = () => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      if (now.getHours() >= 6 && lastDaily !== today) {
        lastDaily = today;
        call("/api/cron/daily");
      }
    };
    daily();
    setInterval(daily, 10 * 60_000);
  }, 10_000);

  console.log("[cron] agendador interno ativo (tick 60s, daily 06h)");
}
