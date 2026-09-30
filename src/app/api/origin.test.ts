import { describe, expect, it } from "vitest";
import { devOrigins, isSameOriginWrite, refuseCrossSite } from "./origin";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";

function request(method: string, headers: Record<string, string>, url = "http://localhost:3000/api/skills"): Request {
  return new Request(url, { method, headers: { host: "localhost:3000", ...headers } });
}

describe("isSameOriginWrite", () => {
  it("lets a read through from anywhere", () => {
    expect(isSameOriginWrite(request("GET", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), [])).toBe(true);
    expect(isSameOriginWrite(request("HEAD", { origin: "https://evil.example" }), [])).toBe(true);
  });

  it("refuses a write sent by another site", () => {
    expect(isSameOriginWrite(request("POST", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), [])).toBe(false);
    // An old browser without Fetch Metadata still sends the Origin.
    expect(isSameOriginWrite(request("POST", { origin: "https://evil.example" }), [])).toBe(false);
    // Another port on localhost is same-site, not same-origin: a different dev server, say.
    expect(isSameOriginWrite(request("PUT", { origin: "http://localhost:8080", "sec-fetch-site": "same-site" }), [])).toBe(false);
    // A sandboxed frame or a file:// page.
    expect(isSameOriginWrite(request("DELETE", { origin: "null" }), [])).toBe(false);
  });

  it("accepts the app's own pages, a forwarded host and a request without an Origin", () => {
    expect(isSameOriginWrite(request("POST", { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }), [])).toBe(true);
    expect(
      isSameOriginWrite(request("POST", { origin: "https://ofa.example", "x-forwarded-host": "ofa.example" }), []),
    ).toBe(true);
    expect(isSameOriginWrite(request("POST", {}), [])).toBe(true);
  });

  it("accepts a host listed in OFA_DEV_ORIGINS, wildcards included", () => {
    const allowed = devOrigins(" box.tail1234.ts.net , *.lan ");
    expect(allowed).toEqual(["box.tail1234.ts.net", "*.lan"]);
    const from = (origin: string) => request("POST", { origin, "sec-fetch-site": "cross-site" });
    expect(isSameOriginWrite(from("http://box.tail1234.ts.net:3000"), allowed)).toBe(true);
    expect(isSameOriginWrite(from("http://mac.lan:3000"), allowed)).toBe(true);
    expect(isSameOriginWrite(from("http://evil.example"), allowed)).toBe(false);
  });
});

describe("refuseCrossSite", () => {
  it("answers a refused write with the error envelope", async () => {
    const res = refuseCrossSite(request("POST", { origin: "https://evil.example" }), []);
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ code: "cross_site" });
    expect(refuseCrossSite(request("POST", {}), [])).toBeNull();
  });
});

describe("proxy", () => {
  it("guards the API routes, including the body-less POSTs", async () => {
    const plant = new NextRequest("http://localhost:3000/api/scheduled-tasks/read", {
      method: "POST",
      headers: { host: "localhost:3000", origin: "https://evil.example", "content-type": "text/plain" },
    });
    expect(proxy(plant)?.status).toBe(403);
    const own = new NextRequest("http://localhost:3000/api/skills", {
      method: "POST",
      headers: { host: "localhost:3000", origin: "http://localhost:3000" },
    });
    expect(proxy(own)).toBeUndefined();
  });
});
