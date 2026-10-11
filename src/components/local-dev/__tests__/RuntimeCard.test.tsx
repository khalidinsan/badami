// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { RuntimeCard } from "@/components/local-dev/RuntimeCard";

/**
 * The card reads several store actions on mount and calls them immediately,
 * which is where a render-time crash would hide. There is no Tauri host under
 * vitest, so the assertions stay on what actually renders rather than on data.
 */
const mounted: Array<{ root: Root; host: HTMLElement }> = [];

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

function renderCard(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<RuntimeCard />);
  });
  mounted.push({ root, host });
  return host;
}

describe("RuntimeCard", () => {
  it("renders its sections without a store or Tauri host", () => {
    const host = renderCard();
    const text = host.textContent ?? "";
    expect(text).toContain("Runtime");
    expect(text).toContain("Database files");
  });

  it("shows an empty state instead of a blank panel", () => {
    const host = renderCard();
    const text = host.textContent ?? "";
    expect(text).toMatch(/No binaries installed yet|version/);
  });

  it("offers the add action", () => {
    const host = renderCard();
    const buttons = Array.from(host.querySelectorAll("button"));
    const add = buttons.find((b) => (b.textContent ?? "").includes("Add version"));
    expect(add).toBeDefined();
  });

  it("says it is still checking before preflight answers", () => {
    const host = renderCard();
    const text = host.textContent ?? "";
    expect(text).toContain("Checking where the database lives");
  });
});
