import { describe, expect, it, vi } from "vitest";

import type { TodayReminder } from "./contracts";
import { handleTodayRemindersRequest } from "./request-handler";

const reminder: TodayReminder = {
  id: "reminder-20260828",
  businessDate: "2026-08-28",
  title: "五点开会",
  scheduledTime: "17:00",
  completed: false,
  completedAt: null,
  alertedAt: null,
  revision: 1,
  createdAt: "2026-08-28T07:00:00.000Z",
  updatedAt: "2026-08-28T07:00:00.000Z",
};

function getRequest(query = "?date=2026-08-28") {
  return new Request(`http://127.0.0.1:3000/api/v1/today-reminders${query}`, {
    headers: { host: "127.0.0.1:3000" },
  });
}

function postRequest(body: unknown) {
  return new Request("http://127.0.0.1:3000/api/v1/today-reminders", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      "idempotency-key": "today-reminder-key-0020",
    },
    body: JSON.stringify(body),
  });
}

describe("handleTodayRemindersRequest", () => {
  it("lists a date and returns the authoritative write", async () => {
    const list = vi.fn(() => [reminder]);
    const listPast = vi.fn(() => [{ ...reminder, id: "past", businessDate: "2026-08-27" }]);
    const execute = vi.fn(async () => ({ reminder }));
    const getResponse = await handleTodayRemindersRequest(getRequest(), { list, listPast, execute });
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({
      reminders: [reminder],
      pastReminders: [{ ...reminder, id: "past", businessDate: "2026-08-27" }],
    });
    expect(listPast).toHaveBeenCalledWith({ beforeBusinessDate: "2026-08-28", limit: 100 });

    const command = {
      type: "add-today-reminder",
      reminderId: reminder.id,
      businessDate: reminder.businessDate,
      title: reminder.title,
      scheduledTime: reminder.scheduledTime,
    };
    const postResponse = await handleTodayRemindersRequest(
      postRequest(command),
      { list, listPast, execute },
    );
    expect(postResponse.status).toBe(200);
    expect(await postResponse.json()).toEqual({ reminder });
    expect(execute).toHaveBeenCalledWith(command, "today-reminder-key-0020");
  });

  it("rejects invalid dates and invalid reminder times", async () => {
    const dependencies = {
      list: vi.fn(() => []),
      listPast: vi.fn(() => []),
      execute: vi.fn(async () => ({ reminder })),
    };
    expect((await handleTodayRemindersRequest(getRequest("?date=2026-02-30"), dependencies)).status)
      .toBe(400);
    expect((await handleTodayRemindersRequest(postRequest({
      type: "add-today-reminder",
      reminderId: reminder.id,
      businessDate: reminder.businessDate,
      title: reminder.title,
      scheduledTime: "25:00",
    }), dependencies)).status).toBe(422);
  });

  it("returns whether the due alert was claimed", async () => {
    const alertedReminder = { ...reminder, alertedAt: "2026-08-28T09:00:00.000Z" };
    const execute = vi.fn(async () => ({ reminder: alertedReminder, alertClaimed: true }));
    const response = await handleTodayRemindersRequest(postRequest({
      type: "claim-today-reminder-alert",
      reminderId: reminder.id,
      expectedRevision: reminder.revision,
    }), { list: vi.fn(() => [reminder]), listPast: vi.fn(() => []), execute });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reminder: alertedReminder, alertClaimed: true });
  });
});
