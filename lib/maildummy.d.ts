export interface AddressObject {
  value: Array<{ address?: string; name: string; group?: Array<{ address?: string; name: string }> }>;
  text: string;
  html: string;
}

/**
 * A mail as parsed by mailparser's `simpleParser` (see its documentation for the full shape).
 * `text` is the text/plain body only; `html` is `false` when there is no HTML part.
 */
export interface ParsedMail {
  subject?: string;
  from?: AddressObject;
  to?: AddressObject | AddressObject[];
  cc?: AddressObject | AddressObject[];
  text?: string;
  html: string | false;
  headers: Map<string, unknown>;
  attachments: Array<{ filename?: string; contentType: string; content: Buffer }>;
  [key: string]: unknown;
}

/** The part of an S3 client that maildummy uses: `new S3Client(...)` or a fake with the same `send`. */
export interface S3Like {
  send(command: any): Promise<any>;
}

export interface FetchOptions {
  /** Ignore mail older than this (S3 `LastModified`). A Date, epoch milliseconds or an ISO 8601 string. Required. */
  since: Date | number | string;
  /** S3 key prefix. Default `raw/`. */
  prefix?: string;
  /** AWS region. Default: the AWS SDK default chain. Ignored when `s3Client` is given. */
  region?: string;
  /** Inject your own client, for example a fake in unit tests. */
  s3Client?: S3Like;
}

export interface WaitForLinkOptions extends FetchOptions {
  /** Regular expression (a RegExp, or a string holding one) searched in the mail bodies. Required. */
  pattern: RegExp | string;
  /** Milliseconds to wait before rejecting with `MailTimeout`. Default 60000. */
  timeout?: number;
  /** Milliseconds between polls. Default 2000. */
  pollInterval?: number;
  /** Injectable for tests. Default: a `setTimeout` promise. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for tests, in epoch milliseconds. Default `Date.now`. */
  now?: () => number;
}

/** No qualifying mail with a matching link arrived within the timeout. `name` is `'MailTimeout'`. */
export class MailTimeout extends Error {
  constructor(message?: string);
}

/** Pattern for a link starting with the literal `prefix`, up to the next whitespace, quote or angle bracket. */
export function linkPattern(prefix: string): RegExp;

/** Mails to `address` (To or Cc), newest first. */
export function fetchMessages(bucket: string, address: string, options: FetchOptions): Promise<ParsedMail[]>;

/** Poll until a mail to `address` contains a match for `pattern`; resolves with the first match. */
export function waitForLink(bucket: string, address: string, options: WaitForLinkOptions): Promise<string>;

export const DEFAULT_PREFIX: string;
