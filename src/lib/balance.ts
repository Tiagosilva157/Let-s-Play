// Divisão equilibrada de times pelo nível técnico (1–5 estrelas, interno).
//
// Regras:
//  • O admin define quantos jogadores por time; o nº de times sai do total
//    de confirmados (o último time fica com o resto, podendo ser menor).
//  • Distribuição gulosa: jogadores do mais forte ao mais fraco, cada um
//    vai para o time de MENOR MÉDIA atual (entre os que ainda têm vaga).
//    Isso equilibra a média mesmo com times de tamanhos diferentes.
//  • Empates são decididos por sorteio — assim "Reorganizar" gera
//    combinações diferentes mantendo o equilíbrio.

export interface BalancePlayer {
  id: string;
  name: string;
  skill: number; // 1–5
}

export interface BalancedTeam {
  players: BalancePlayer[];
  size: number;      // tamanho-alvo
  avg: number;       // média de estrelas (visível só para o admin)
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const avgOf = (ps: BalancePlayer[]) =>
  ps.length ? ps.reduce((s, x) => s + x.skill, 0) / ps.length : 0;

export function balanceTeams(players: BalancePlayer[], perTeam: number): BalancedTeam[] {
  const total = players.length;
  if (total === 0 || perTeam < 1) return [];

  const teamCount = Math.max(1, Math.ceil(total / perTeam));
  const sizes = Array.from({ length: teamCount }, (_, i) =>
    i < teamCount - 1 ? perTeam : total - perTeam * (teamCount - 1)
  );

  const teams: BalancePlayer[][] = sizes.map(() => []);

  // 1) serpentina: fortes→fracos, indo e voltando entre os times
  //    (o embaralhamento dentro de cada nível muda as combinações
  //    a cada "Reorganizar", mantendo o equilíbrio)
  const ordered = shuffle(players).sort((a, b) => b.skill - a.skill);
  let idx = 0, dir = 1;
  for (const p of ordered) {
    let guard = 0;
    while (teams[idx].length >= sizes[idx] && guard++ < teamCount * 2) {
      idx += dir;
      if (idx >= teamCount) { idx = teamCount - 1; dir = -1; }
      if (idx < 0) { idx = 0; dir = 1; }
    }
    teams[idx].push(p);
    idx += dir;
    if (idx >= teamCount) { idx = teamCount - 1; dir = -1; }
    if (idx < 0) { idx = 0; dir = 1; }
  }

  // 2) refino: trocas aleatórias entre times que reduzam a
  //    diferença das médias (funciona também com tamanhos diferentes)
  const spread = () => {
    const avgs = teams.map(avgOf);
    return Math.max(...avgs) - Math.min(...avgs);
  };
  for (let it = 0; it < 400 && spread() > 0.05; it++) {
    const a = Math.floor(Math.random() * teamCount);
    let b = Math.floor(Math.random() * teamCount);
    if (a === b) b = (b + 1) % teamCount;
    if (!teams[a].length || !teams[b].length) continue;
    const i = Math.floor(Math.random() * teams[a].length);
    const j = Math.floor(Math.random() * teams[b].length);
    const before = spread();
    [teams[a][i], teams[b][j]] = [teams[b][j], teams[a][i]];
    if (spread() >= before) {
      [teams[a][i], teams[b][j]] = [teams[b][j], teams[a][i]]; // desfaz
    }
  }

  return teams.map((ps, i) => ({
    players: ps,
    size: sizes[i],
    avg: Math.round(avgOf(ps) * 10) / 10,
  }));
}

/** Mensagem para o grupo: apenas nomes e times — nunca as estrelas. */
export function teamsMessage(teamName: string, date: string, teams: { players: { name: string }[] }[]): string {
  const [y, m, d] = date.split("-");
  const lines = [
    `🏐 *Times do jogo — ${teamName}* (${d}/${m}/${y.slice(2)})`,
    ``,
  ];
  teams.forEach((t, i) => {
    lines.push(`*Time ${i + 1}:*`);
    t.players.forEach((p, j) => lines.push(`${j + 1}. ${p.name}`));
    lines.push(``);
  });
  lines.push(`Bom jogo! 🎉`);
  return lines.join("\n");
}
