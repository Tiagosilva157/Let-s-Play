// Datas no fuso do Brasil. O servidor roda em UTC: sem isto, a partir das 21h
// de Brasília o "hoje" já vira "amanhã" e o jogo do dia some das listas.
const TZ = "America/Sao_Paulo";

/** AAAA-MM-DD de hoje em Brasília. */
export function todayBR(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Hora atual (0-23) em Brasília. */
export function hourBR(): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()));
}

/** Início do jogo como Date (a data/hora do jogo são horário de Brasília). */
export function gameStart(date: string, time: string): Date {
  return new Date(`${date}T${String(time).slice(0, 8)}-03:00`);
}
