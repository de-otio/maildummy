'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'eml');

/** The raw bytes of a shared fixture, e.g. `fixture('plus-address')`. */
function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, `${name}.eml`));
}

/** An error shaped like the AWS SDK v3 service errors (`name` is the error code). */
function awsError(name) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 400 } });
}

/** A mail that is not addressed to anyone a test looks for. */
function filler(i) {
  return Buffer.from(`From: noreply@example.org\r\nTo: nobody${i}@example.org\r\nSubject: filler\r\n\r\nhello\r\n`);
}

/**
 * An in-memory S3 client with the same `send(command)` surface as the SDK's.
 *
 * `objects` is an array of `{ key, body, lastModified }`. Calls are recorded
 * in `lists` (one entry per ListObjectsV2 call) and `gets` (keys fetched).
 * `onList(callNumber)` and `onGet(key)` may throw to simulate AWS errors.
 */
function fakeS3({ objects, pageSize = 1000, onList, onGet, streamBodies = false }) {
  const lists = [];
  const gets = [];
  const byKey = new Map();
  const send = async (command) => {
    if (command instanceof ListObjectsV2Command) {
      const { Bucket, Prefix, ContinuationToken } = command.input;
      lists.push({ Bucket, Prefix, ContinuationToken });
      if (onList) {
        onList(lists.length);
      }
      const all = (typeof objects === 'function' ? objects() : objects)
        .filter((o) => o.key.startsWith(Prefix || ''))
        .sort((a, b) => (a.key < b.key ? -1 : 1)); // S3 lists in key order, not time order
      all.forEach((o) => byKey.set(o.key, o));
      const start = ContinuationToken ? Number(ContinuationToken) : 0;
      const page = all.slice(start, start + pageSize);
      const truncated = start + pageSize < all.length;
      return {
        Contents: page.map((o) => ({ Key: o.key, LastModified: o.lastModified, Size: o.body.length })),
        IsTruncated: truncated,
        NextContinuationToken: truncated ? String(start + pageSize) : undefined,
      };
    }
    if (command instanceof GetObjectCommand) {
      const { Key } = command.input;
      gets.push(Key);
      if (onGet) {
        onGet(Key);
      }
      const object = byKey.get(Key);
      return {
        Body: streamBodies ? Readable.from([object.body]) : { transformToByteArray: async () => new Uint8Array(object.body) },
      };
    }
    throw new Error(`unexpected command ${command.constructor.name}`);
  };
  return { send, lists, gets };
}

/** A manual clock: `sleep` advances `now`, and nothing really waits. */
function fakeClock(start = 1_000_000) {
  const clock = {
    time: start,
    sleeps: [],
    now: () => clock.time,
    sleep: async (ms) => {
      clock.sleeps.push(ms);
      clock.time += ms;
    },
  };
  return clock;
}

module.exports = { fixture, awsError, filler, fakeS3, fakeClock };
