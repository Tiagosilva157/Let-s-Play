// Teste ponta a ponta das integrações Asaas + GP Connect usando o código real do app.
// Uso: npx tsx --env-file=.env.local scripts/e2e-integracoes.mts [telefone-para-teste]
import { supabaseAdmin } from "../src/lib/supabase/server";
import { ensureAsaasCustomer } from "../src/lib/asaas-customer";
import { Asaas } from "../src/lib/asaas";
import { dispatchPending, sendPixToPlayer, buildListMessage } from "../src/lib/messaging";
import { GpConnect } from "../src/lib/gpconnect";

const TEST_PHONE = process.argv[2] ?? "5531998535464";
const db = supabaseAdmin();
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = "") => {
  if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${extra}`); }
};

console.log("1. Configurações carregadas");
const { data: cfg } = await db.from("system_settings").select("key, value");
const s = Object.fromEntries((cfg ?? []).map((r) => [r.key, String(r.value)]));
check("chave do Asaas presente", !!s.asaas_api_key);
check("token do GP Connect presente", !!s.gpconnect_token);
check("token do webhook presente", (s.asaas_webhook_token ?? "").length >= 32);

console.log("\n2. GP Connect — mensagem individual");
try {
  await GpConnect.sendTextMessage(TEST_PHONE, "🏐 [Teste] Let's Play — mensagem individual funcionando.");
  check("envio individual aceito pela API", true);
} catch (e) { check("envio individual", false, String(e).slice(0, 140)); }

console.log("\n3. GP Connect — validações de formato");
try { await GpConnect.sendGroupMessage("123", "x"); check("recusa ID de grupo inválido", false); }
catch { check("recusa ID de grupo inválido", true); }
try { await GpConnect.sendTextMessage("123", "x"); check("recusa telefone inválido", false); }
catch { check("recusa telefone inválido", true); }

console.log("\n4. Asaas — cliente com CPF e e-mail");
const { data: player } = await db.from("players")
  .insert({ name: "[TESTE] Integração", phone: "5599111112222", email: "teste.integracao@exemplo.com", cpf_cnpj: "24971563792" })
  .select("id, name, phone, email, cpf_cnpj, asaas_customer_id").single();
let customerId = "";
try {
  customerId = await ensureAsaasCustomer(player!);
  check("cliente criado no Asaas", !!customerId);
} catch (e) { check("cliente criado no Asaas", false, String(e).slice(0, 160)); }

console.log("\n5. Asaas — sem CPF a cobrança é bloqueada com mensagem clara");
const { data: noCpf } = await db.from("players")
  .insert({ name: "[TESTE] Sem CPF", phone: "5599111113333" })
  .select("id, name, phone, email, cpf_cnpj, asaas_customer_id").single();
try { await ensureAsaasCustomer(noCpf!); check("bloqueia sem CPF", false); }
catch (e) { check("bloqueia sem CPF", (e as Error).name === "MissingCustomerDataError"); }

console.log("\n6. Asaas — cobrança Pix do avulso");
let paymentId = "", copypaste = "";
if (customerId) {
  try {
    const pay = await Asaas.createPixPayment({
      customer: customerId, value: 15, dueDate: new Date().toISOString().slice(0, 10),
      description: "[TESTE] Avulso", externalReference: "e2e",
    });
    paymentId = pay.id;
    const qr = await Asaas.getPixQr(pay.id);
    copypaste = qr.payload;
    check("cobrança Pix criada", !!pay.id);
    check("QR e copia-e-cola gerados", !!qr.payload && !!qr.encodedImage);
  } catch (e) { check("cobrança Pix criada", false, String(e).slice(0, 160)); }
}

console.log("\n7. Asaas — assinatura mensal do mensalista");
let subId = "";
if (customerId) {
  try {
    const sub = await Asaas.createSubscription({
      customer: customerId, value: 50, nextDueDate: "2026-09-10",
      description: "[TESTE] Mensalidade", externalReference: "e2e-sub",
    });
    subId = sub.id;
    check("assinatura recorrente criada", !!sub.id);
  } catch (e) { check("assinatura recorrente criada", false, String(e).slice(0, 160)); }
}

console.log("\n8. Pix enviado ao WhatsApp do avulso (fila + despacho)");
if (copypaste) {
  const { data: team } = await db.from("teams").select("id, name").limit(1).single();
  await sendPixToPlayer({
    teamId: team!.id, phone: TEST_PHONE, playerName: "Teste Avulso", teamName: team!.name,
    date: "2026-08-13", time: "20:00", amount: 15, copypaste, minutes: 15,
  });
  await new Promise((r) => setTimeout(r, 2500));
  const { data: sent } = await db.from("message_dispatches")
    .select("status, error").eq("recipient", TEST_PHONE).order("created_at", { ascending: false }).limit(1).maybeSingle();
  check("mensagem de Pix enviada", sent?.status === "sent", JSON.stringify(sent));
}

console.log("\n9. Lista do jogo para o grupo");
const { data: game } = await db.from("games").select("id").order("date").limit(1).maybeSingle();
if (game) {
  const built = await buildListMessage(game.id);
  check("mensagem da lista montada", !!built?.body?.includes("Confirmados"));
  if (built?.team.whatsapp_group_id) {
    try {
      await GpConnect.sendGroupMessage(built.team.whatsapp_group_id, "🏐 [Teste] " + built.body);
      check("lista enviada ao grupo", true);
    } catch (e) { check("lista enviada ao grupo", false, String(e).slice(0, 140)); }
  }
}

console.log("\n10. Fila sem mensagens travadas");
await dispatchPending();
const { count: stuck } = await db.from("message_dispatches")
  .select("id", { count: "exact", head: true }).in("status", ["queued", "sending", "failed"]);
check("nenhuma mensagem presa na fila", (stuck ?? 0) === 0, `pendentes: ${stuck}`);

// limpeza
console.log("\nLimpando dados de teste...");
if (paymentId) await Asaas.cancelPayment(paymentId).catch(() => {});
if (subId) await Asaas.cancelSubscription(subId).catch(() => {});
await db.from("message_dispatches").delete().eq("recipient", TEST_PHONE);
await db.from("players").delete().in("id", [player!.id, noCpf!.id]);

console.log(`\nResultado: ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
