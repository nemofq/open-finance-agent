import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { profilePath } from "@/lib/paths";
import type { InvestorProfile } from "@/lib/profile/types";

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-profile-routes-"));
  process.env.OFA_HOME = home;
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

const request = (url: string, method: string, body: unknown, contentType = "application/json") =>
  new Request(url, { method, headers: { "content-type": contentType }, body: JSON.stringify(body) });

describe("/api/profile", () => {
  it("round-trips the profile and reports where it lives", async () => {
    const { DELETE, GET, PUT } = await import("./route");

    expect(await (await GET()).json()).toEqual({ profile: null, path: profilePath() });

    const input = {
      experience: { level: "intermediate", role: "individual" },
      objectives: { primary: "income", horizon: "3_10y" },
      style: { depth: "standard" },
    };
    const saved = (await (await PUT(request("http://localhost/api/profile", "PUT", input))).json()) as {
      profile: InvestorProfile;
    };
    expect(saved.profile).toMatchObject(input);

    const reread = (await (await GET()).json()) as { profile: InvestorProfile };
    expect(reread.profile).toEqual(saved.profile);

    const updated = (await (
      await PUT(request("http://localhost/api/profile", "PUT", { ...input, risk: { tolerance: "moderate" } }))
    ).json()) as { profile: InvestorProfile };
    expect(updated.profile.risk).toEqual({ tolerance: "moderate" });

    expect(await (await DELETE()).json()).toEqual({ ok: true });
    expect(await (await GET()).json()).toEqual({ profile: null, path: profilePath() });
  });

  it("refuses a body the schema does not accept", async () => {
    const { PUT } = await import("./route");
    const res = await PUT(request("http://localhost/api/profile", "PUT", { risk: { tolerance: "extreme" } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("risk.tolerance");
  });

  it("refuses a body that is not declared JSON", async () => {
    const { PUT } = await import("./route");
    const res = await PUT(request("http://localhost/api/profile", "PUT", {}, "text/plain"));
    expect(res.status).toBe(415);
  });
});
