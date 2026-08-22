import { TasteLabsApp } from "@/components/taste-labs/taste-labs-app";
import { DemoAccessGate } from "@/components/gym/demo-access-gate";

export default function TasteLabsPage() {
  return (
    <DemoAccessGate>
      <div className="tasteLabsRoot">
        <TasteLabsApp />
      </div>
    </DemoAccessGate>
  );
}
