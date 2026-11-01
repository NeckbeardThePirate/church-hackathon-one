import { AuthGate } from "./components/AuthGate";
import { WorkspaceApp } from "./components/WorkspaceApp";

export default function Home() {
  return (
    <AuthGate>
      <WorkspaceApp />
    </AuthGate>
  );
}
