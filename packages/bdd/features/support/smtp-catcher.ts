import * as net from "net";

// A minimal in-process SMTP sink so BDD scenarios can capture REAL outbound
// mail (e.g. the password-reset link) without Docker or an external catcher.
// The @email-capture hook binds it to an ephemeral 127.0.0.1 port and points
// the platform's SMTP settings at it via the admin API; the API's nodemailer
// sender then delivers here like it would to any relay. Speaks just enough
// ESMTP for nodemailer: greeting, EHLO (advertising AUTH so nodemailer's
// configured credentials are accepted), MAIL/RCPT/DATA, QUIT. Accepts any
// AUTH — it's a test sink bound to loopback, not a mail server.

export interface CaughtMail {
  from: string;
  to: string[];
  // Raw RFC 5322 payload as received (headers + MIME body, dot-unstuffed).
  data: string;
}

export class SmtpCatcher {
  readonly messages: CaughtMail[] = [];
  port = 0;

  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();

  async start(): Promise<number> {
    if (this.server) return this.port;
    const server = net.createServer((socket) => this.handle(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      // Port 0 → the OS picks a free port; no collisions with anything local.
      server.listen(0, "127.0.0.1", () => resolve());
    });
    this.port = (server.address() as net.AddressInfo).port;
    return this.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // Poll for a captured message matching `match` (delivery is async relative
  // to the HTTP response only in edge cases — the API awaits its send — so
  // this normally resolves on the first tick).
  async waitForMessage(
    match: (m: CaughtMail) => boolean,
    timeoutMs = 10_000,
  ): Promise<CaughtMail> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(match);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(
          `no matching mail captured within ${timeoutMs}ms ` +
            `(${this.messages.length} message(s) seen)`,
        );
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private handle(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => socket.destroy());

    let buffer = "";
    let inData = false;
    let dataLines: string[] = [];
    let from = "";
    let to: string[] = [];
    // AUTH LOGIN sends username/password as two follow-up base64 lines.
    let authLoginSteps = 0;

    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 bdd-catcher ESMTP");

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            this.messages.push({ from, to, data: dataLines.join("\r\n") });
            dataLines = [];
            from = "";
            to = [];
            reply("250 2.0.0 queued");
          } else {
            // Dot-unstuffing per RFC 5321 §4.5.2.
            dataLines.push(line.startsWith("..") ? line.slice(1) : line);
          }
          continue;
        }

        if (authLoginSteps > 0) {
          authLoginSteps -= 1;
          reply(authLoginSteps === 0 ? "235 2.7.0 ok" : "334 UGFzc3dvcmQ6");
          continue;
        }

        const verb = line.split(/[\s:]/, 1)[0]?.toUpperCase() ?? "";
        switch (verb) {
          case "EHLO":
          case "HELO":
            reply("250-bdd-catcher");
            reply("250-AUTH PLAIN LOGIN");
            reply("250 8BITMIME");
            break;
          case "AUTH":
            if (/^AUTH LOGIN\s*$/i.test(line)) {
              authLoginSteps = 2; // expect username then password
              reply("334 VXNlcm5hbWU6");
            } else {
              reply("235 2.7.0 ok"); // AUTH PLAIN <b64> (any credentials)
            }
            break;
          case "MAIL":
            from = line.replace(/^MAIL FROM:\s*/i, "").replace(/[<>]/g, "");
            reply("250 2.1.0 ok");
            break;
          case "RCPT":
            to.push(line.replace(/^RCPT TO:\s*/i, "").replace(/[<>]/g, ""));
            reply("250 2.1.5 ok");
            break;
          case "DATA":
            inData = true;
            reply("354 go ahead");
            break;
          case "QUIT":
            reply("221 bye");
            socket.end();
            break;
          default:
            reply("250 ok"); // NOOP/RSET/anything else — permissive sink
        }
      }
    });
  }
}

// Undo quoted-printable transfer encoding: drop soft line breaks (`=` at end
// of line) and decode =XX hex escapes. nodemailer QP-encodes the HTML/text
// parts, which splits long URLs across lines and turns `=` into `=3D` — so
// decode BEFORE regexing anything (like a reset link) out of a captured body.
export function decodeQuotedPrintable(s: string): string {
  return s
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}
