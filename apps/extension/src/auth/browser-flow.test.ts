import { describe, expect, it } from "vitest";

import { classifyLaunchFailure } from "./browser-flow";

describe("what Chrome means by a failed launch", () => {
  it("reads the sentence it says when the user closes the window", () => {
    expect(classifyLaunchFailure("The user did not approve access.")).toBe("cancelled");
    expect(classifyLaunchFailure("User cancelled the sign-in.")).toBe("cancelled");
  });

  it("treats anything it does not recognise as a failure", () => {
    // Fail-closed on the reading, not on the flow: a real failure reported as a
    // cancellation is a sign-in button that silently does nothing, which is the
    // worse of the two mistakes.
    expect(classifyLaunchFailure("Authorization page could not be loaded.")).toBe("failed");
    expect(classifyLaunchFailure("User interaction required.")).toBe("failed");
    expect(classifyLaunchFailure("")).toBe("failed");
  });
});
