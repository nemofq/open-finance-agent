import { describe, expect, it } from "vitest";
import { providerErrorText } from "./error-text";

describe("providerErrorText", () => {
  it("keeps the status line and drops the wire body around its message", () => {
    const raw =
      'OpenAI API error (401): {"message":"Incorrect API key provided: sk-abc123. You can find your API key at https://platform.openai.com/account/api-keys.","type":"invalid_request_error","param":null,"code":"invalid_api_key"}';
    expect(providerErrorText(raw)).toBe(
      "OpenAI API error (401): Incorrect API key provided: sk-abc123. You can find your API key at https://platform.openai.com/account/api-keys.",
    );
  });

  it("finds the message however the provider nests it", () => {
    expect(providerErrorText('{"error":{"message":"invalid x-api-key","type":"authentication_error"}}')).toBe("invalid x-api-key");
    expect(providerErrorText('Gemini (400): {"error":{"code":400,"message":"API key not valid","status":"INVALID_ARGUMENT"}}')).toBe(
      "Gemini (400): API key not valid",
    );
    expect(providerErrorText('{"error":"invalid_grant","error_description":"Token has been revoked"}')).toBe("invalid_grant");
    expect(providerErrorText('{"detail":"Not authenticated"}')).toBe("Not authenticated");
  });

  it("leaves a message that was never a wire body alone", () => {
    expect(providerErrorText("OpenRouter /models did not respond within 15 s")).toBe("OpenRouter /models did not respond within 15 s");
    expect(providerErrorText("  Could not reach https://llm.example.com/v1: ECONNREFUSED  ")).toBe(
      "Could not reach https://llm.example.com/v1: ECONNREFUSED",
    );
  });

  it("keeps the first line of anything multi-line, because a dump says nothing under a field", () => {
    expect(providerErrorText("fetch failed\n    at node:internal/deps/undici\n    at async run")).toBe("fetch failed");
  });

  it("caps a message a provider wrote at length, marking where it was cut", () => {
    const long = providerErrorText(`Anthropic (400): {"error":{"message":"${"x".repeat(500)}"}}`);
    expect(long).toHaveLength(200);
    expect(long.endsWith("…")).toBe(true);
    expect(long.startsWith("Anthropic (400): xxx")).toBe(true);
  });

  it("falls back to the first line when the body is not JSON, or carries no message", () => {
    expect(providerErrorText("Gateway (502): <html><body>Bad Gateway</body></html>")).toBe(
      "Gateway (502): <html><body>Bad Gateway</body></html>",
    );
    expect(providerErrorText('Gateway (502): {"status":"overloaded"}')).toBe('Gateway (502): {"status":"overloaded"}');
    expect(providerErrorText('Broken (500): {"message":')).toBe('Broken (500): {"message":');
  });
});
