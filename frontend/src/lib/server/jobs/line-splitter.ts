/**
 * Turns a stream of text chunks into complete lines. Pure and synchronous.
 * Handles \n, \r\n and lone \r (progress-bar style output), and caps line length so a
 * runaway process without newlines cannot grow memory without bound.
 */
export class LineSplitter {
  private buffer = "";

  constructor(private readonly maxLineLength = 64 * 1024) {}

  /** Feed a chunk; returns the lines it completed (without terminators, empty lines dropped). */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const parts = this.buffer.split(/\r\n|\n|\r/);
    // A trailing "\r" may be the first half of "\r\n"; keep it until the next chunk.
    let rest = parts.pop() ?? "";
    if (this.buffer.endsWith("\r")) {
      const last = parts.pop();
      rest = last === undefined ? "\r" : `${last}\r`;
    }
    this.buffer = rest;
    const lines = parts.filter((l) => l.length > 0);
    while (this.buffer.length > this.maxLineLength) {
      lines.push(this.buffer.slice(0, this.maxLineLength));
      this.buffer = this.buffer.slice(this.maxLineLength);
    }
    return lines;
  }

  /** Remaining partial line at end of stream. */
  flush(): string[] {
    const rest = this.buffer.replace(/\r$/, "");
    this.buffer = "";
    return rest ? [rest] : [];
  }
}
