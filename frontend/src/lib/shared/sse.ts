/**
 * Server-Sent Events wire format (https://html.spec.whatwg.org/multipage/server-sent-events.html).
 * `encode*` is used by the API; `parseSSE` exists for tests and non-browser clients.
 */

export interface SSEMessage {
  id?: string | number;
  event?: string;
  data: string;
  /** Reconnection delay hint for the browser, in ms. */
  retry?: number;
}

export function encodeSSE(message: SSEMessage): string {
  let out = "";
  if (message.retry !== undefined) out += `retry: ${Math.max(0, Math.floor(message.retry))}\n`;
  if (message.id !== undefined) out += `id: ${String(message.id).replace(/[\r\n]/g, "")}\n`;
  if (message.event) out += `event: ${message.event.replace(/[\r\n]/g, "")}\n`;
  for (const line of message.data.split(/\r\n|\r|\n/)) out += `data: ${line}\n`;
  return `${out}\n`;
}

/** A comment line: ignored by EventSource, keeps proxies from closing an idle stream. */
export function encodeSSEComment(text = "keep-alive"): string {
  return `: ${text.replace(/[\r\n]/g, " ")}\n\n`;
}

/** Parse a complete SSE text into messages (comments dropped). */
export function parseSSE(text: string): SSEMessage[] {
  const messages: SSEMessage[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    const data: string[] = [];
    const msg: Partial<SSEMessage> = {};
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const idx = line.indexOf(":");
      const field = idx === -1 ? line : line.slice(0, idx);
      const value = idx === -1 ? "" : line.slice(idx + 1).replace(/^ /, "");
      if (field === "data") data.push(value);
      else if (field === "id") msg.id = value;
      else if (field === "event") msg.event = value;
      else if (field === "retry" && /^\d+$/.test(value)) msg.retry = Number(value);
    }
    if (data.length || msg.id !== undefined || msg.event) messages.push({ ...msg, data: data.join("\n") });
  }
  return messages;
}
