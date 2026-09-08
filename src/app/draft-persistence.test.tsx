// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DraftPersistence } from "./draft-persistence";

function TestForm() {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  return (
    <form>
      <input aria-label="任务标题" onChange={(event) => setTitle(event.target.value)} value={title} />
      <textarea aria-label="备注" onChange={(event) => setNote(event.target.value)} value={note} />
      <input aria-label="已完成" checked={checked} onChange={(event) => setChecked(event.target.checked)} type="checkbox" />
    </form>
  );
}

function Page({ pathname }: { readonly pathname: string }) {
  return <><DraftPersistence pathname={pathname} storage={localStorage} /><TestForm /></>;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("DraftPersistence", () => {
  it("restores controlled fields after leaving and returning to a page", async () => {
    const user = userEvent.setup();
    const first = render(<Page pathname="/sleep" />);
    await user.type(screen.getByLabelText("任务标题"), "今晚十一点睡");
    await user.type(screen.getByLabelText("备注"), "停止刷手机");
    await user.click(screen.getByLabelText("已完成"));
    expect(screen.getByText("草稿已保存")).toBeVisible();
    first.unmount();

    render(<Page pathname="/sleep" />);
    await waitFor(() => expect(screen.getByLabelText("任务标题")).toHaveValue("今晚十一点睡"));
    expect(screen.getByLabelText("备注")).toHaveValue("停止刷手机");
    expect(screen.getByLabelText("已完成")).toBeChecked();
    expect(screen.getByText("已恢复本页草稿")).toBeVisible();
  });

  it("keeps drafts isolated between pages", async () => {
    const user = userEvent.setup();
    const first = render(<Page pathname="/today" />);
    await user.type(screen.getByLabelText("任务标题"), "今日草稿");
    first.unmount();

    render(<Page pathname="/reading" />);
    expect(screen.getByLabelText("任务标题")).toHaveValue("");
  });
});
