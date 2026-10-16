// Lista do jogo para o link público — a mesma fotografia que vai ao grupo do
// WhatsApp (buildRoster), para o jogo seguir mesmo se o WhatsApp cair.
// Nomes completos só para quem está logado; sem login, "Primeiro I." (o link
// pode circular fora do grupo).
import { buildRoster } from "@/lib/messaging";

export interface PublicRosterEntry { name: string; status: string }
export interface PublicRoster {
  membersPay: boolean;
  capacity: number;
  members: PublicRosterEntry[];
  membersHolding: number;
  dropins: PublicRosterEntry[];
  dropinsOccupying: number;
  dropinSlots: number;
  dropinSlotsFree: number;
  waitlist: PublicRosterEntry[];
  waitlistMinutes: number;
  fullNames: boolean;
  updatedAt: string;
}

function shortName(full: string) {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[1][0].toUpperCase()}.` : parts[0];
}

export async function loadPublicRoster(gameId: string, fullNames: boolean): Promise<PublicRoster | null> {
  const built = await buildRoster(gameId);
  if (!built) return null;
  const { roster: r, game: g, team: t } = built;
  const name = (e: { name: string; status: string }) => ({ name: fullNames ? e.name : shortName(e.name), status: e.status });
  return {
    membersPay: g.membersPay,
    capacity: r.capacity,
    members: r.members.map(name),
    membersHolding: r.membersHolding,
    dropins: r.dropins.map(name),
    dropinsOccupying: r.dropinsOccupying,
    dropinSlots: r.dropinSlots,
    dropinSlotsFree: r.dropinSlotsFree,
    waitlist: r.waitlist.map(name),
    waitlistMinutes: t.waitlist_minutes ?? 60,
    fullNames,
    updatedAt: new Date().toISOString(),
  };
}
