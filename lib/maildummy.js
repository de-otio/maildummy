'use strict';

/**
 * Fetch mail captured by a maildummy S3 bucket.
 *
 * The two entry points are `waitForLink`, which polls until a link matching a
 * caller-supplied pattern shows up in a mail for one address, and
 * `fetchMessages`, which returns the parsed mails themselves. The behaviour
 * mirrors the Python package (`maildummy.fetch`).
 */

const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { simpleParser } = require('mailparser');
const he = require('he');

const DEFAULT_PREFIX = 'raw/';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_POLL_INTERVAL_MS = 2000;

/** No qualifying mail with a matching link arrived within the timeout. */
class MailTimeout extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailTimeout';
  }
}

/**
 * Build a pattern for a link starting with `prefix`.
 *
 * The prefix is matched literally. The match runs up to the next whitespace,
 * quote or angle bracket, so `#` fragments such as
 * `https://app.example.com/#/sign-in/link#otp=123456` are kept whole.
 *
 * @param {string} prefix
 * @returns {RegExp}
 */
function linkPattern(prefix) {
  return new RegExp(escapeRegExp(prefix) + '[^\\s"\'<>]*');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A fresh, stateless copy of the pattern (a `g` or `y` flag would carry `lastIndex` over). */
function compile(pattern) {
  if (pattern instanceof RegExp) {
    return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
  }
  if (typeof pattern === 'string') {
    return new RegExp(pattern);
  }
  throw new TypeError('pattern must be a string or a RegExp');
}

function toDate(since) {
  if (since === undefined || since === null) {
    throw new TypeError('since is required (a Date, an epoch in milliseconds, or an ISO 8601 string)');
  }
  const date = since instanceof Date ? since : new Date(since);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`since is not a valid date: ${String(since)}`);
  }
  return date;
}

/** Addresses of the To and Cc headers, lower-cased. mailparser yields AddressObjects (or arrays of them). */
function recipients(parsed) {
  const found = new Set();
  const visit = (entries) => {
    for (const entry of entries || []) {
      if (entry.address) {
        found.add(entry.address.trim().toLowerCase());
      }
      if (entry.group) {
        visit(entry.group);
      }
    }
  };
  for (const header of [parsed.to, parsed.cc]) {
    for (const addressObject of [].concat(header || [])) {
      visit(addressObject.value);
    }
  }
  return found;
}

function errorCode(err) {
  return (err && (err.name || err.Code || err.code)) || undefined;
}

async function bodyToBuffer(body) {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (body && typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/** `text/plain` bodies first, then HTML. Returns the first match, HTML-unescaped if it came from HTML. */
function findLink(parsed, pattern) {
  const fromText = typeof parsed.text === 'string' ? pattern.exec(parsed.text) : null;
  if (fromText) {
    // Only HTML needs unescaping. In plain text "&section=1" is a literal query
    // string, and unescaping would turn "&sect" into a "§".
    return fromText[0];
  }
  const fromHtml = typeof parsed.html === 'string' ? pattern.exec(parsed.html) : null;
  return fromHtml ? he.decode(fromHtml[0]) : null;
}

async function listObjects(client, bucket, prefix, sinceMs) {
  const objects = [];
  let continuationToken;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    );
    for (const object of page.Contents || []) {
      if (object.Key && object.LastModified && new Date(object.LastModified).getTime() >= sinceMs) {
        objects.push({ key: object.Key, modified: new Date(object.LastModified).getTime() });
      }
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  // Newest first. The key breaks ties so the order is deterministic.
  objects.sort((a, b) => b.modified - a.modified || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  return objects;
}

/**
 * Yield `{ key, parsed }` for mails to `address` at or after `since`, newest first.
 *
 * Objects older than `since` are never fetched. Keys in `skip` are not fetched
 * either; the caller uses that to avoid re-downloading mails it has already
 * examined (S3 objects are immutable).
 */
async function* candidates(client, bucket, address, sinceMs, prefix, skip) {
  const objects = await listObjects(client, bucket, prefix, sinceMs);
  const wanted = address.trim().toLowerCase();
  for (const { key } of objects) {
    if (skip.has(key)) {
      continue;
    }
    let body;
    try {
      body = (await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body;
    } catch (err) {
      if (errorCode(err) === 'NoSuchKey') {
        continue; // expired by the retention rule between list and get
      }
      throw err;
    }
    // skipHtmlToText: `text` must be the real text/plain part, not text
    // generated from the HTML, so that the HTML fallback sees the real markup.
    const parsed = await simpleParser(await bodyToBuffer(body), {
      skipHtmlToText: true,
      skipTextToHtml: true,
      skipImageLinks: true,
    });
    if (recipients(parsed).has(wanted)) {
      yield { key, parsed };
    } else {
      skip.add(key);
    }
  }
}

function makeClient(region, s3Client) {
  return s3Client || new S3Client(region ? { region } : {});
}

/**
 * @typedef {import('./maildummy').FetchOptions} FetchOptions
 * @typedef {import('./maildummy').WaitForLinkOptions} WaitForLinkOptions
 */

/**
 * Return the mails addressed (To or Cc) to `address`, newest first, as parsed
 * by mailparser's `simpleParser`.
 *
 * Only objects under `prefix` whose `LastModified` is at or after `since` are
 * downloaded. Recipient comparison is case-insensitive and understands
 * `+tags` and quoted display names. AWS SDK errors (AccessDenied,
 * NoSuchBucket, ...) propagate.
 *
 * @param {string} bucket
 * @param {string} address
 * @param {FetchOptions} options
 */
async function fetchMessages(bucket, address, options = {}) {
  const sinceMs = toDate(options.since).getTime();
  const client = makeClient(options.region, options.s3Client);
  const messages = [];
  for await (const { parsed } of candidates(client, bucket, address, sinceMs, options.prefix ?? DEFAULT_PREFIX, new Set())) {
    messages.push(parsed);
  }
  return messages;
}

/**
 * Poll until a mail to `address` contains a match for `pattern`; return the match.
 *
 * `pattern` is a RegExp or a string holding a regular expression (see
 * `linkPattern` for a URL prefix). It is searched in the text/plain body
 * first, then in the HTML body, of the newest qualifying mail first; the first
 * match (the whole match) is returned, HTML-unescaped if it came from HTML.
 * Mails older than `since` are ignored; allow a little slack for clock skew,
 * since S3 timestamps have one-second resolution.
 *
 * Rejects with `MailTimeout` when nothing matches within `timeout`
 * milliseconds (one attempt is always made). AWS SDK errors reject at once and
 * are never retried. `sleep` and `now` are injectable for tests.
 *
 * @param {string} bucket
 * @param {string} address
 * @param {WaitForLinkOptions} options
 * @returns {Promise<string>}
 */
async function waitForLink(bucket, address, options = {}) {
  const {
    pattern,
    timeout = DEFAULT_TIMEOUT_MS,
    pollInterval = DEFAULT_POLL_INTERVAL_MS,
    prefix = DEFAULT_PREFIX,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = options;
  if (pattern === undefined || pattern === null) {
    throw new TypeError('pattern is required');
  }
  const compiled = compile(pattern);
  const sinceMs = toDate(options.since).getTime();
  const client = makeClient(options.region, options.s3Client);
  const deadline = now() + timeout;
  const examined = new Set(); // keys of mails already read that had no match

  for (;;) {
    for await (const { key, parsed } of candidates(client, bucket, address, sinceMs, prefix, examined)) {
      const link = findLink(parsed, compiled);
      if (link !== null) {
        return link;
      }
      examined.add(key);
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new MailTimeout(`no mail to ${address} in ${bucket} matched ${compiled.source} within ${timeout}ms`);
    }
    await sleep(Math.min(pollInterval, remaining));
  }
}

module.exports = { MailTimeout, fetchMessages, linkPattern, waitForLink, DEFAULT_PREFIX };
