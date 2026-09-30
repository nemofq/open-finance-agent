import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Skill } from "@/lib/skills/skill";

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-skills-api-"));
  process.env.OFA_HOME = home;
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

const json = (method: string, body: unknown) =>
  new Request("http://localhost/api/skills", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const params = (name: string) => ({ params: Promise.resolve({ name }) });

const draft = { name: "my-screen", description: "Screen for value names.", body: "# Screen" };

describe("/api/skills", () => {
  it("creates, edits, lists and deletes a user skill", async () => {
    const { GET, POST } = await import("./route");
    const { DELETE, PUT } = await import("./[name]/route");

    const created = await POST(json("POST", draft));
    expect(created.status).toBe(201);
    expect(((await created.json()) as { skill: Skill }).skill).toMatchObject({
      name: "my-screen",
      source: "user",
      body: "# Screen",
    });

    const listed = (await (await GET()).json()) as { skills: Skill[]; userSkillsDir: string };
    expect(listed.skills.map((skill) => skill.name)).toContain("my-screen");
    expect(listed.userSkillsDir).toBe(path.join(home, "skills"));

    const edited = await PUT(
      json("PUT", { description: "Now for growth.", body: "# v2", disableModelInvocation: true }),
      params("my-screen"),
    );
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { skill: Skill }).skill).toMatchObject({
      description: "Now for growth.",
      body: "# v2",
      disableModelInvocation: true,
    });

    const deleted = await DELETE(new Request("http://localhost"), params("my-screen"));
    expect(deleted.status).toBe(204);
    const gone = (await (await GET()).json()) as { skills: Skill[] };
    expect(gone.skills.map((skill) => skill.name)).not.toContain("my-screen");
  });

  it("409s a name that is already a user skill, then frees it again on delete", async () => {
    const { POST } = await import("./route");
    const { DELETE } = await import("./[name]/route");

    expect((await POST(json("POST", { ...draft, name: "taken" }))).status).toBe(201);
    const clash = await POST(json("POST", { ...draft, name: "taken" }));
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: string }).error).toContain("already exists");

    await DELETE(new Request("http://localhost"), params("taken"));
    expect((await POST(json("POST", { ...draft, name: "taken" }))).status).toBe(201);
  });

  it("lets a user skill shadow a bundled one", async () => {
    const { POST } = await import("./route");
    const res = await POST(json("POST", { ...draft, name: "earnings-preview" }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { skill: Skill }).skill.source).toBe("user");
  });

  it("400s an invalid draft and a body that is not JSON", async () => {
    const { POST } = await import("./route");

    const bad = await POST(json("POST", { ...draft, name: "Not A Name" }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("lowercase");

    const typed = await POST(json("POST", { ...draft, body: 42 }));
    expect(typed.status).toBe(400);
    expect(((await typed.json()) as { error: string }).error).toContain("body");

    const empty = await POST(
      new Request("http://localhost/api/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(empty.status).toBe(400);
  });

  it("415s a skill sent as text/plain, which a cross-site page could send without a preflight", async () => {
    const { GET, POST } = await import("./route");
    const { PUT } = await import("./[name]/route");
    const plain = (method: string, body: unknown) =>
      new Request("http://localhost/api/skills", { method, headers: { "content-type": "text/plain" }, body: JSON.stringify(body) });

    expect((await POST(plain("POST", { ...draft, name: "planted" }))).status).toBe(415);
    const listed = (await (await GET()).json()) as { skills: Skill[] };
    expect(listed.skills.map((skill) => skill.name)).not.toContain("planted");

    expect((await POST(json("POST", { ...draft, name: "kept" }))).status).toBe(201);
    expect((await PUT(plain("PUT", { description: "d", body: "# injected" }), params("kept"))).status).toBe(415);
  });

  it("404s editing or deleting a skill that is not the user's", async () => {
    const { DELETE, PUT } = await import("./[name]/route");

    for (const name of ["never-existed", "earnings-review"]) {
      const put = await PUT(json("PUT", { description: "d", body: "# b" }), params(name));
      expect(put.status).toBe(404);
      expect((await DELETE(new Request("http://localhost"), params(name))).status).toBe(404);
    }
  });
});
