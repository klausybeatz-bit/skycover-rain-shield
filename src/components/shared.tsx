import { Badge } from "@/components/ui/badge";
import { isOnchainEnabled } from "@/lib/chain";
import type { PolicyStatus } from "@/lib/demo";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  right,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {right}
    </div>
  );
}

const STATUS_META: Record<PolicyStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "border-primary/40 text-primary" },
  eligible: { label: "Payout eligible", className: "border-success/40 text-success" },
  paid: { label: "Paid out", className: "border-success/60 bg-success/10 text-success" },
  not_eligible: { label: "No payout — rain met threshold", className: "border-muted-foreground/40 text-muted-foreground" },
  expired: { label: "Expired", className: "border-muted-foreground/40 text-muted-foreground" },
};

export function PolicyStatusBadge({ status }: { status: PolicyStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  );
}

export function SimulatedBadge({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Badge variant="outline" className={cn("border-warning/40 text-warning", className)}>
      {children ?? "Simulated"}
    </Badge>
  );
}

export function OnchainPendingNotice({ children }: { children?: React.ReactNode }) {
  if (isOnchainEnabled()) return null;
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
      <span className="font-medium">On-chain pending:</span>{" "}
      {children ??
        "The SkyCover smart contracts are not deployed to Sepolia yet, so this feature runs in clearly-labelled demo mode. Nothing here touches real funds."}
    </div>
  );
}
