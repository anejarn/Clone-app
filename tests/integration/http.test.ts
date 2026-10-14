import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, handle, parseOrThrow, readJson, requireUser } from "@/lib/server/http";

const req = (init: RequestInit & { url?: string } = {}) => new Request(init.url ?? "http://localhost:3100/api/x", init);
const body = async (r: Response) => ({ status: r.status, json: await r.json() });

describe("handle()", () => {
  it("turns AppError into its status and a safe JSON body", async () => {
    const r = await handle(async () => {
      throw new AppError(409, "UNAVAILABLE", "Ces dates ne sont plus disponibles.");
    })();
    expect(await body(r)).toEqual({ status: 409, json: { error: { code: "UNAVAILABLE", message: "Ces dates ne sont plus disponibles." } } });
  });

  it("hides unexpected errors behind a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handle(async () => {
      throw new Error("connection to 10.0.0.5:5432 refused, password=hunter2");
    })();
    const { status, json } = await body(r);
    expect(status).toBe(500);
    expect(JSON.stringify(json)).not.toMatch(/10\.0\.0\.5|hunter2|stack/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("passes successful responses through", async () => {
    const r = await handle(async () => Response.json({ ok: true }, { status: 201 }))();
    expect(await body(r)).toEqual({ status: 201, json: { ok: true } });
  });
});

describe("assertSameOrigin()", () => {
  it("accepts same-origin and Origin-less requests, rejects others", () => {
    expect(() => assertSameOrigin(req({ headers: { origin: "http://localhost:3100" } }))).not.toThrow();
    expect(() => assertSameOrigin(req())).not.toThrow();
    for (const origin of ["https://evil.example", "http://localhost:3101", "null", "http://localhost:3100.evil.example"]) {
      expect(() => assertSameOrigin(req({ headers: { origin } }))).toThrow(AppError);
    }
  });
});

describe("input parsing", () => {
  const schema = z.object({ adults: z.number().int().min(1) });

  it("rejects malformed JSON with 400", async () => {
    await expect(readJson(req({ method: "POST", body: "{nope" }), schema)).rejects.toMatchObject({ status: 400, code: "INVALID_JSON" });
  });

  it("names the failing field", () => {
    expect(() => parseOrThrow(schema, { adults: 0 })).toThrow(/adults/);
    expect(() => parseOrThrow(schema, null)).toThrow(AppError);
  });
});

describe("requireUser()", () => {
  it("is 401 without a session, including forged cookies", async () => {
    await expect(requireUser(req())).rejects.toMatchObject({ status: 401 });
    await expect(requireUser(req({ headers: { cookie: "better-auth.session_token=forged.value" } }))).rejects.toMatchObject({ status: 401 });
  });
});
