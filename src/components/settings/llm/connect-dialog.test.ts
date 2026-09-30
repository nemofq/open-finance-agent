import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Connected, CONNECTED_CLOSE_SECONDS } from "./connect-dialog";

describe("Connected", () => {
  it("announces the provider and when the dialog will close", () => {
    const html = renderToStaticMarkup(React.createElement(Connected, { name: "ChatGPT (Codex)", onClose: () => {} }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Connected to ChatGPT (Codex)");
    expect(html).toContain(`Closing in ${CONNECTED_CLOSE_SECONDS}s`);
  });
});
