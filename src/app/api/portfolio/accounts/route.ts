import { randomUUID } from "node:crypto";
import { errorResponse, readJson } from "@/app/api/http";
import { portfolioDir } from "@/lib/paths";
import { accountInputSchema } from "@/lib/portfolio/schema";
import { createPortfolioStore } from "@/lib/portfolio/store";
import type { Account } from "@/lib/portfolio/types";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ accounts: await createPortfolioStore(portfolioDir()).listAccounts() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** The id and the source are the server's to assign; everything else comes from the form. */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = await readJson(request, accountInputSchema);
    const account: Account = { ...input, id: randomUUID(), source: { kind: "manual" } };
    return Response.json({ account: await createPortfolioStore(portfolioDir()).saveAccount(account) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
