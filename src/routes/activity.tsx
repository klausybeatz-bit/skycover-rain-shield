import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowDownToLine, ArrowUpFromLine, CloudRain, FilePlus2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDemoState } from "@/hooks/use-demo-state";
import { clearDemoData, type EventType } from "@/lib/demo";
import { explorerTxUrl } from "@/lib/chain";

export const Route = createFileRoute("/activity")({
  head: () => ({
    meta: [
      { title: "Transparency — SkyCover" },
      {
        name: "description",
        content:
          "Every policy purchase, oracle update, pool movement and payout in one ledger, with transaction hashes and Sepolia explorer links.",
      },
      { property: "og:title", content: "Transparency — SkyCover" },
      {
        property: "og:description",
        content: "The full audit trail of SkyCover activity, on-chain and simulated.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ActivityPage,
});

const EVENT_META: Record<EventType, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  policy_created: { icon: FilePlus2, label: "Policy purchase" },
  oracle_update: { icon: CloudRain, label: "Oracle update" },
  pool_deposit: { icon: ArrowDownToLine, label: "Pool deposit" },
  pool_withdraw: { icon: ArrowUpFromLine, label: "Pool withdrawal" },
  payout: { icon: Activity, label: "Payout" },
};

function ActivityPage() {
  const demo = useDemoState();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader
        title="Transparency"
        description="Purchases, oracle updates, pool activity and payouts in one ledger. Real transactions carry a Sepolia explorer link; simulated entries are labelled."
        right={
          demo.events.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearDemoData();
                toast.info("Demo data cleared");
              }}
            >
              <Trash2 className="size-4" /> Clear demo data
            </Button>
          ) : undefined
        }
      />

      {demo.events.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <Activity className="size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No activity yet — buy a policy or run the demo flow to generate events.
            </p>
            <Button asChild>
              <Link to="/demo">Open Demo Mode</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {demo.events.map((e) => {
            const meta = EVENT_META[e.type];
            return (
              <Card key={e.id} className="border-border/60">
                <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                    <meta.icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{e.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {meta.label} · {new Date(e.at).toLocaleString()}
                    </p>
                  </div>
                  {e.txHash ? (
                    <a
                      href={explorerTxUrl(e.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-primary underline underline-offset-4"
                    >
                      {e.txHash.slice(0, 10)}… ↗
                    </a>
                  ) : (
                    <Badge variant="outline" className="border-warning/40 text-warning">
                      Simulated · no tx
                    </Badge>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
