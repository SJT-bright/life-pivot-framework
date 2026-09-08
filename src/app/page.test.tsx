import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => navigation);

import HomePage from "./page";

describe("HomePage", () => {
  beforeEach(() => navigation.redirect.mockReset());

  it("redirects the root route to Today during render", () => {
    HomePage();

    expect(navigation.redirect).toHaveBeenCalledOnce();
    expect(navigation.redirect).toHaveBeenCalledWith("/today");
  });
});
