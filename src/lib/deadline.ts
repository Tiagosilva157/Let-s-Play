// Prazo limite dos mensalistas: conversão entre "dia da semana + horário" e "horas antes do jogo".
/** Horas entre o prazo (dia da semana + hora) e o jogo (dia da semana + hora), olhando para trás na semana. */
export function hoursBeforeGame(gameWeekday: number, gameTime: string, deadlineWeekday: number, deadlineTime: string) {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const week = 7 * 1440;
  const diff = ((gameWeekday * 1440 + mins(gameTime)) - (deadlineWeekday * 1440 + mins(deadlineTime)) + week) % week;
  return diff / 60; // 0 = mesmo instante do jogo
}
