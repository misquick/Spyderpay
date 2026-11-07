import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { WebhookRequest, WebhookResult, WebhookSender } from '../../ports/system.js';

/** Addresses a webhook must never reach in production (basic SSRF protection). */
const privateRanges = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4],
] as const) privateRanges.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::1', 128], ['fc00::', 7], ['fe80::', 10], ['::ffff:0:0', 96]] as const) {
  privateRanges.addSubnet(net, prefix, 'ipv6');
}

export class HttpWebhookSender implements WebhookSender {
  constructor(
    private readonly allowPrivate: boolean,
    private readonly timeoutMs = 10_000,
  ) {}

  async send(request: WebhookRequest): Promise<WebhookResult> {
    try {
      const url = new URL(request.url);
      if (!this.allowPrivate && (await this.isPrivate(url.hostname))) {
        return { ok: false, error: 'webhook URL points to a private network address' };
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      await response.body?.cancel();
      if (response.status >= 200 && response.status < 300) return { ok: true, status: response.status };
      return { ok: false, error: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async isPrivate(hostname: string): Promise<boolean> {
    const host = hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
    return addresses.some((a) => privateRanges.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'));
  }
}
