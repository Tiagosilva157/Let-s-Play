import { requireAdmin } from "@/lib/admin";
import TeamForm from "../TeamForm";

export default async function NewTeamPage() {
  await requireAdmin();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Nova turma</h1>
      <TeamForm />
    </div>
  );
}
