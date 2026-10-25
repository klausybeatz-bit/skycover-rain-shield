import { BadgeCheck, CircleMinus, Clock, FlaskConical, Info, ShieldCheck } from "lucide-react";

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
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
      <div>
        <h1 className="font-display text-[1.75rem] font-semibold tracking-tight sm:text-[2.125rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

/**
 * Status is always communicated with a label *and* an icon, never colour alone:
 * policy/coverage states use lavender, eligible states use sage, and inactive
 * states fall back to the neutral muted tone.
 */
const STATUS_META: Record<
  PolicyStatus,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  active: {
    label: "Active",
    className: "border-lavender/60 bg-lavender/15 text-lavender-strong",
    icon: ShieldCheck,
  },
  eligible: {
    label: "Payout eligible",
    className: "border-sage/60 bg-sage/15 text-sage-strong",
    icon: BadgeCheck,
  },
  paid: {
    label: "Paid out",
    className: "border-sage/70 bg-sage/25 text-sage-strong",
    icon: BadgeCheck,
  },
  not_eligible: {
    label: "No payout — rain met threshold",
    className: "border-border bg-muted text-muted-foreground",
    icon: CircleMinus,
  },
  expired: {
    label: "Expired",
    className: "border-border bg-muted text-muted-foreground",
    icon: Clock,
  },
};

export function PolicyStatusBadge({ status }: { status: PolicyStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={meta.className}>
      <Icon />
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
    <Badge variant="outline" className={cn("border-amber/60 bg-amber/15 text-amber-strong", className)}>
      <FlaskConical />
      {children ?? "Simulated"}
    </Badge>
  );
}

export function OnchainPendingNotice({ children }: { children?: React.ReactNode }) {
  if (isOnchainEnabled()) return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber/40 bg-amber/10 px-4 py-3.5 text-[0.875rem] leading-relaxed text-amber-strong">
      <Info className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-semibold">Demo mode:</span>{" "}
        {children ??
          "the SkyCover smart contracts are not deployed to Sepolia yet, so this feature runs against the local demo ledger. No real funds are involved."}
      </p>
    </div>
  );
}
