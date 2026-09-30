import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { SectionHeader } from "@/components/shared/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The investor profile's pointer to the holdings. They are edited in one place, the portfolio page,
 * so this section only says what the agent sees of them and where to change them.
 */
export function HoldingsSection() {
  return (
    <section aria-labelledby="holdings-section" className="space-y-4">
      <SectionHeader
        id="holdings-section"
        title="Holdings"
        description="Your accounts and positions. They reach the model only when the agent calls portfolio_get."
      />
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            Add and edit accounts, enter or import positions, record transactions and see import history on the
            Portfolio page.
          </p>
          <Link href="/portfolio" className={buttonVariants({ variant: "outline" })}>
            Open Portfolio
            <ArrowRightIcon />
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}
