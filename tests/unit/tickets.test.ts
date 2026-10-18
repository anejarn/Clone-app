import { describe, expect, it } from "vitest";
import { MAX_TICKET_COST_CENTS, parseComment, parseCostForm, parseNewTicketForm, parseStatusForm } from "@/lib/admin/ticket-form";
import { allowedStatusChanges, canSeeTicket, checkStatusChange, isOpenTicket, statusFields, ticketStatusText, TICKET_STATUSES, type TicketStatusKey } from "@/lib/operations/tickets";

/** Pannes: who sees and moves a ticket, and the forms (the repair's cost is money: exact centimes). */

const admin = { role: "ADMIN", userId: "a" };
const agent = { role: "AGENT", userId: "g" };
const colleague = { role: "AGENT", userId: "c" };
const ticket = (status: TicketStatusKey, over: Partial<{ reporterId: string | null; assigneeId: string | null }> = {}) => ({
  status,
  waitingFor: status === "WAITING" ? ("PART" as const) : null,
  reporterId: "c",
  assigneeId: "g",
  ...over,
});

describe("visibility", () => {
  it("associés see every ticket; an agent the ones they reported or are assigned to", () => {
    expect(canSeeTicket(admin, { reporterId: null, assigneeId: null })).toBe(true);
    expect(canSeeTicket(agent, { reporterId: "g", assigneeId: null })).toBe(true);
    expect(canSeeTicket(agent, { reporterId: "x", assigneeId: "g" })).toBe(true);
    expect(canSeeTicket(agent, { reporterId: "x", assigneeId: "y" })).toBe(false);
    expect(canSeeTicket(agent, { reporterId: null, assigneeId: null })).toBe(false);
  });
});

describe("status changes", () => {
  it("associés may move a ticket to any other status (cancel, reopen included)", () => {
    expect(allowedStatusChanges(admin, ticket("OPEN"))).toEqual(["IN_PROGRESS", "WAITING", "RESOLVED", "CANCELLED"]);
    expect(allowedStatusChanges(admin, ticket("RESOLVED"))).toEqual(["OPEN", "IN_PROGRESS", "WAITING", "CANCELLED"]);
    // Waiting for something else: allowed again.
    expect(allowedStatusChanges(admin, ticket("WAITING"))).toContain("WAITING");
  });

  it("the assigned agent moves it forward while it is open; never cancels or reopens it", () => {
    expect(allowedStatusChanges(agent, ticket("OPEN"))).toEqual(["IN_PROGRESS", "WAITING", "RESOLVED"]);
    expect(allowedStatusChanges(agent, ticket("IN_PROGRESS"))).toEqual(["WAITING", "RESOLVED"]);
    expect(allowedStatusChanges(agent, ticket("RESOLVED"))).toEqual([]);
    expect(allowedStatusChanges(agent, ticket("CANCELLED"))).toEqual([]);
  });

  it("the reporter (not assigned) and other agents can't change it", () => {
    expect(allowedStatusChanges(colleague, ticket("OPEN"))).toEqual([]);
    expect(allowedStatusChanges({ role: "AGENT", userId: "z" }, ticket("OPEN"))).toEqual([]);
  });

  it("checkStatusChange: the same status, waiting without a reason, and forbidden moves are refused", () => {
    expect(checkStatusChange(agent, ticket("OPEN"), "RESOLVED", null)).toEqual({ ok: true });
    expect(checkStatusChange(agent, ticket("OPEN"), "CANCELLED", null)).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(checkStatusChange(admin, ticket("OPEN"), "OPEN", null)).toEqual({ ok: false, reason: "SAME" });
    expect(checkStatusChange(admin, ticket("OPEN"), "WAITING", null)).toEqual({ ok: false, reason: "WAITING_FOR" });
    expect(checkStatusChange(admin, ticket("WAITING"), "WAITING", "PART")).toEqual({ ok: false, reason: "SAME" });
    expect(checkStatusChange(admin, ticket("WAITING"), "WAITING", "CONTRACTOR")).toEqual({ ok: true });
  });

  it("statusFields sets the dates the database checks (tickets_status_check)", () => {
    const now = new Date("2026-10-18T10:00:00Z");
    for (const s of TICKET_STATUSES) {
      const f = statusFields(s, "CONTRACTOR", now);
      expect(f.resolvedAt !== null, s).toBe(s === "RESOLVED");
      expect(f.cancelledAt !== null, s).toBe(s === "CANCELLED");
      expect(f.waitingFor !== null, s).toBe(s === "WAITING");
    }
    expect(ticketStatusText("WAITING", "PART")).toBe("En attente d'une pièce");
    expect(ticketStatusText("RESOLVED", null)).toBe("Réparée");
    expect(TICKET_STATUSES.filter(isOpenTicket)).toEqual(["OPEN", "IN_PROGRESS", "WAITING"]);
  });
});

describe("forms", () => {
  it("a new ticket needs a home (or a task), a title and a category; priority defaults to normal", () => {
    expect(parseNewTicketForm({ listingId: "l1", title: "  Fuite sous l'évier ", category: "PLUMBING" })).toEqual({
      ok: true,
      input: { listingId: "l1", taskId: null, title: "Fuite sous l'évier", description: "", category: "PLUMBING", priority: "NORMAL" },
    });
    expect(parseNewTicketForm({ taskId: "t1", title: "Clim en panne", category: "AIR_CONDITIONING", priority: "URGENT" })).toMatchObject({ ok: true, input: { listingId: null, taskId: "t1", priority: "URGENT" } });
    expect(parseNewTicketForm({ title: "x", category: "LOCK" })).toMatchObject({ ok: false, fieldErrors: { listingId: expect.any(String) } });
    expect(parseNewTicketForm({ listingId: "l1", title: "", category: "LOCK" })).toMatchObject({ ok: false, fieldErrors: { title: expect.any(String) } });
    expect(parseNewTicketForm({ listingId: "l1", title: "x", category: "ROOF" })).toMatchObject({ ok: false, fieldErrors: { category: expect.any(String) } });
    expect(parseNewTicketForm({ listingId: "l1", title: "x", category: "LOCK", priority: "CRITICAL" })).toMatchObject({ ok: false, fieldErrors: { priority: expect.any(String) } });
    expect(parseNewTicketForm({ listingId: "l1", title: "x".repeat(121), category: "LOCK" })).toMatchObject({ ok: false });
    expect(parseNewTicketForm({ listingId: "l1", title: "a\u0007b", category: "LOCK" })).toMatchObject({ ok: false });
    expect(parseNewTicketForm({ listingId: "../x", title: "x", category: "LOCK" })).toMatchObject({ ok: false });
  });

  it("a status: waiting needs its reason, which is dropped for any other status", () => {
    expect(parseStatusForm({ status: "WAITING", waitingFor: "" })).toMatchObject({ ok: false, fieldErrors: { waitingFor: expect.any(String) } });
    expect(parseStatusForm({ status: "WAITING", waitingFor: "CONTRACTOR", note: "Plombier demain 9 h" })).toEqual({
      ok: true,
      input: { status: "WAITING", waitingFor: "CONTRACTOR", note: "Plombier demain 9 h" },
    });
    expect(parseStatusForm({ status: "RESOLVED", waitingFor: "PART" })).toEqual({ ok: true, input: { status: "RESOLVED", waitingFor: null, note: "" } });
    expect(parseStatusForm({ status: "FIXED" })).toMatchObject({ ok: false });
  });

  it("the cost is typed in dirhams and stored in exact centimes; re-invoicing needs a cost", () => {
    expect(parseCostForm({ cost: "350" })).toEqual({ ok: true, input: { costCents: 35_000, rechargeOwner: false } });
    expect(parseCostForm({ cost: "1 250,50", rechargeOwner: "on" })).toEqual({ ok: true, input: { costCents: 125_050, rechargeOwner: true } });
    expect(parseCostForm({ cost: "19,99" })).toEqual({ ok: true, input: { costCents: 1_999, rechargeOwner: false } });
    expect(parseCostForm({ cost: "0" })).toEqual({ ok: true, input: { costCents: 0, rechargeOwner: false } });
    expect(parseCostForm({ cost: "" })).toEqual({ ok: true, input: { costCents: null, rechargeOwner: false } });
    expect(parseCostForm({ cost: "", rechargeOwner: "on" })).toMatchObject({ ok: false, fieldErrors: { cost: expect.stringContaining("refacturer") } });
    for (const bad of ["-5", "12,345", "1e3", "abc", "350 MAD"]) expect(parseCostForm({ cost: bad }), bad).toMatchObject({ ok: false });
    expect(parseCostForm({ cost: "1000000" })).toEqual({ ok: true, input: { costCents: MAX_TICKET_COST_CENTS, rechargeOwner: false } });
    expect(parseCostForm({ cost: "1000000,01" })).toMatchObject({ ok: false });
  });

  it("a comment is 1 to 4 000 characters", () => {
    expect(parseComment("  Pièce commandée  ")).toEqual({ ok: true, body: "Pièce commandée" });
    expect(parseComment("   ")).toMatchObject({ ok: false });
    expect(parseComment("x".repeat(4001))).toMatchObject({ ok: false });
  });
});
