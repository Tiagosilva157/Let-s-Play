// Teste de auditoria das regras de negócio (roda contra o banco real e limpa tudo no final).
// Uso: node --env-file=.env.local scripts/audit-test.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local)"); process.exit(1); }
const db = createClient(url, key);

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

// ---------- setup ----------
console.log("Setup: turma de teste (capacidade 3, 2 mensalistas)...");
const { data: team } = await db.from("teams").insert({
  name: "[TESTE] Auditoria", slug: "teste-auditoria", weekday: 1, game_time: "20:00",
  address: "Quadra Teste", capacity: 3, monthly_fee: 60, dropin_fee: 15,
}).select().single();

const players = [];
for (let i = 1; i <= 5; i++) {
  const { data: p } = await db.from("players").insert({ name: `[TESTE] Jogador ${i}`, phone: `55990000000${i}` }).select().single();
  players.push(p);
}
await db.from("team_members").insert([
  { team_id: team.id, player_id: players[0].id },
  { team_id: team.id, player_id: players[1].id },
]);

const { data: game } = await db.from("games").insert({
  team_id: team.id, date: "2099-01-04", time: "20:00",
  opens_at: new Date(Date.now() - 3600e3).toISOString(),
  confirm_until: new Date(Date.now() + 86400e3).toISOString(),
  withdraw_until: new Date(Date.now() + 86400e3).toISOString(),
  status: "scheduled",
}).select().single();

// ---------- testes ----------
console.log("\n1. Abertura de lista (fn_open_lists)");
const open = await db.rpc("fn_open_lists");
const { data: invited } = await db.from("game_participants").select("*").eq("game_id", game.id);
check("lista aberta", (open.data?.count ?? 0) >= 1 && Array.isArray(open.data?.opened));
check("2 mensalistas convidados (invited)", invited?.filter((p) => p.status === "invited").length === 2);

console.log("\n2. Mensalista confirma / recusa");
const c1 = await db.rpc("fn_confirm_member", { p_game_id: game.id, p_player_id: players[0].id });
check("mensalista 1 confirma", c1.data?.ok === true);
const d1 = await db.rpc("fn_decline_member", { p_game_id: game.id, p_player_id: players[1].id });
check("mensalista 2 recusa e libera vaga", d1.data?.ok === true);

console.log("\n3. Capacidade: 3 vagas, 1 confirmado → 2 livres para avulsos");
const r1 = await db.rpc("fn_reserve_dropin", { p_game_id: game.id, p_player_id: players[2].id });
check("avulso 1 reserva", r1.data?.ok === true && r1.data?.reserved_until);
const r2 = await db.rpc("fn_reserve_dropin", { p_game_id: game.id, p_player_id: players[3].id });
check("avulso 2 reserva (última vaga)", r2.data?.ok === true);

console.log("\n4. Corrida pela última vaga (2 pedidos simultâneos na lista cheia)");
const [r3, r4] = await Promise.all([
  db.rpc("fn_reserve_dropin", { p_game_id: game.id, p_player_id: players[4].id }),
  db.rpc("fn_reserve_dropin", { p_game_id: game.id, p_player_id: players[1].id }), // mensalista que recusou tentando como avulso
]);
const fulls = [r3.data, r4.data].filter((r) => r?.error === "full");
check("lista cheia: nenhum entra, ambos recebem 'full'/waitlist", fulls.length === 2, JSON.stringify([r3.data, r4.data]));
check("waitlist registrada", [r3.data, r4.data].some((r) => r?.waitlisted));

console.log("\n5. Pagamento confirmado (simulação de webhook)");
const { data: charge } = await db.from("charges").insert({
  player_id: players[2].id, team_id: team.id, game_id: game.id, type: "dropin", amount: 15, status: "received",
}).select().single();
await db.from("game_participants").update({ charge_id: charge.id }).eq("game_id", game.id).eq("player_id", players[2].id);
const cp = await db.rpc("fn_confirm_dropin_payment", { p_charge_id: charge.id });
check("avulso pago vira confirmado", cp.data?.confirmed === true, JSON.stringify(cp.data));

console.log("\n6. Expiração de reserva libera vaga e promove waitlist");
await db.from("game_participants").update({ reserved_until: new Date(Date.now() - 60e3).toISOString() })
  .eq("game_id", game.id).eq("player_id", players[3].id);
const exp = await db.rpc("fn_expire_reservations");
check("reserva vencida expirada", (exp.data?.expired ?? []).length === 1, JSON.stringify(exp.data));
const { data: afterExp } = await db.from("game_participants").select("player_id, status").eq("game_id", game.id);
const promoted = afterExp?.find((p) => p.status === "reserved");
check("primeiro da waitlist promovido para reserved", !!promoted);

console.log("\n7. Desistência dentro do prazo");
const w1 = await db.rpc("fn_withdraw_dropin", { p_game_id: game.id, p_player_id: players[2].id });
check("avulso confirmado desiste no prazo", w1.data?.ok === true);

console.log("\n8. Desistência fora do prazo é bloqueada");
await db.from("games").update({ withdraw_until: new Date(Date.now() - 60e3).toISOString() }).eq("id", game.id);
// recoloca um confirmado para testar
await db.from("game_participants").update({ status: "confirmed" }).eq("game_id", game.id).eq("player_id", players[2].id);
const w2 = await db.rpc("fn_withdraw_dropin", { p_game_id: game.id, p_player_id: players[2].id });
check("bloqueada com 'withdraw_deadline_passed'", w2.data?.error === "withdraw_deadline_passed", JSON.stringify(w2.data));

console.log("\n9. Pagamento chegando com lista cheia → pending_review");
// enche a lista de novo e simula pagamento de quem está fora
await db.from("games").update({ confirm_until: new Date(Date.now() + 86400e3).toISOString() }).eq("id", game.id);
const { data: fullParts } = await db.from("game_participants").select("player_id, status").eq("game_id", game.id);
const heldNow = fullParts.filter((p) => ["confirmed", "reserved", "invited"].includes(p.status)).length;
if (heldNow < 3) {
  // garante lista cheia confirmando manualmente
  for (const p of fullParts) {
    if (!["confirmed", "reserved", "invited"].includes(p.status)) {
      await db.from("game_participants").update({ status: "confirmed" }).eq("game_id", game.id).eq("player_id", p.player_id);
      const { data: check2 } = await db.from("game_participants").select("player_id, status").eq("game_id", game.id);
      if (check2.filter((x) => ["confirmed", "reserved", "invited"].includes(x.status)).length >= 3) break;
    }
  }
}
const { data: outsider } = await db.from("game_participants").select("player_id").eq("game_id", game.id).eq("status", "waitlist").limit(1).maybeSingle();
if (outsider) {
  const { data: charge2 } = await db.from("charges").insert({
    player_id: outsider.player_id, team_id: team.id, game_id: game.id, type: "dropin", amount: 15, status: "received",
  }).select().single();
  const cp2 = await db.rpc("fn_confirm_dropin_payment", { p_charge_id: charge2.id });
  check("vira pending_review (decisão do admin)", cp2.data?.pending_review === true, JSON.stringify(cp2.data));
} else {
  console.log("  (sem waitlist para testar — pulado)");
}

console.log("\n10. Mensalista adicionado após lista aberta consegue confirmar");
await db.from("game_participants").delete().eq("game_id", game.id); // limpa lista
const { data: p6 } = await db.from("players").insert({ name: "[TESTE] Novo Mensalista", phone: "5599000000099" }).select().single();
await db.from("team_members").insert({ team_id: team.id, player_id: p6.id });
const c6 = await db.rpc("fn_confirm_member", { p_game_id: game.id, p_player_id: p6.id });
check("confirma mesmo sem linha 'invited' prévia", c6.data?.ok === true, JSON.stringify(c6.data));

// ---------- cleanup ----------
console.log("\nLimpando dados de teste...");
await db.from("charges").delete().eq("team_id", team.id);
await db.from("games").delete().eq("team_id", team.id);
await db.from("teams").delete().eq("id", team.id);
for (const p of [...players, p6]) await db.from("players").delete().eq("id", p.id);

console.log(`\nResultado: ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
