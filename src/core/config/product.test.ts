import { describe, expect, it } from "vitest";

import { PRODUCT } from "./product";

describe("PRODUCT", () => {
  it("declares one installation owner without collaboration features", () => {
    expect(PRODUCT.ownership).toBe("single-owner");
    expect(PRODUCT.capabilities).not.toContain("multi-user");
    expect(PRODUCT.capabilities).not.toContain("marketplace");
  });
});
