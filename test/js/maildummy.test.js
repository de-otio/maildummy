'use strict';

const { MailTimeout, fetchMessages, linkPattern, waitForLink } = require('../../lib/maildummy');
const { fixture, awsError, filler, fakeS3, fakeClock } = require('./helpers');

const T0 = Date.parse('2026-01-01T12:00:00Z');
const SINCE = new Date(T0 - 60_000);
const APP = linkPattern('https://app.example.com/');

/** A bucket holding the given fixtures, one minute after SINCE, one second apart. */
function bucketWith(...names) {
  return fakeS3({
    objects: names.map((name, i) => ({
      key: `raw/${name}`,
      body: fixture(name),
      lastModified: new Date(T0 + i * 1000),
    })),
  });
}

async function linkFor(fixtureName, address, pattern = APP) {
  const s3Client = bucketWith(fixtureName);
  return waitForLink('bucket', address, { pattern, since: SINCE, timeout: 0, s3Client });
}

describe('recipients', () => {
  test('a +tag is part of the address', async () => {
    expect(await linkFor('plus-address', 'user+tag@example.com')).toBe(
      'https://app.example.com/auth/verify?token=plus123&type=magiclink',
    );
    // The bare address is a different recipient.
    const s3Client = bucketWith('plus-address');
    expect(await fetchMessages('bucket', 'user@example.com', { since: SINCE, s3Client })).toEqual([]);
  });

  test('comparison is case-insensitive in both directions', async () => {
    const expected = 'https://app.example.com/auth/verify?token=case123';
    expect(await linkFor('mixed-case-recipient', 'user+tag@example.com')).toBe(expected);
    expect(await linkFor('mixed-case-recipient', 'USER+TAG@EXAMPLE.COM')).toBe(expected);
  });

  test('quoted display names containing commas do not split the recipient list', async () => {
    const expected = 'https://app.example.com/auth/verify?token=comma123';
    expect(await linkFor('display-name-comma', 'jane@example.com')).toBe(expected);
    expect(await linkFor('display-name-comma', 'bob@example.org')).toBe(expected);
    // Fragments of the display names are not addresses.
    const s3Client = bucketWith('display-name-comma');
    expect(await fetchMessages('bucket', 'doe@example.com', { since: SINCE, s3Client })).toEqual([]);
  });

  test('an RFC 2047 display name containing a comma', async () => {
    expect(await linkFor('encoded-display-name-comma', 'jane.encoded@example.com')).toBe(
      'https://app.example.com/auth/verify?token=encoded123',
    );
  });

  test('a recipient present only in Cc', async () => {
    expect(await linkFor('cc-only', 'cc.user@example.com')).toBe(
      'https://app.example.com/auth/verify?token=cc123',
    );
  });
});

describe('bodies', () => {
  test('quoted-printable with soft line breaks inside the URL', async () => {
    expect(await linkFor('quoted-printable', 'qp@example.com')).toBe(
      'https://app.example.com/auth/verify?token=qp123456789012345678901234567890&type=magiclink&redirect_to=https%3A%2F%2Fapp.example.com%2Fhome',
    );
  });

  test('base64', async () => {
    expect(await linkFor('base64', 'b64@example.com')).toBe(
      'https://app.example.com/auth/verify?token=b64123&type=magiclink',
    );
  });

  test('iso-8859-1 is decoded with its declared charset', async () => {
    const s3Client = bucketWith('latin1');
    const [mail] = await fetchMessages('bucket', 'latin1@example.com', { since: SINCE, s3Client });
    expect(mail.text).toContain('café-grüße-123');
    expect(await linkFor('latin1', 'latin1@example.com', /café-grüße-\d+/)).toBe('café-grüße-123');
    expect(await linkFor('latin1', 'latin1@example.com')).toBe('https://app.example.com/verify?code=latin1');
  });

  test('an unknown charset does not crash', async () => {
    expect(await linkFor('unknown-charset', 'unknown@example.com')).toBe(
      'https://app.example.com/auth/verify?token=unknown123',
    );
  });

  test('HTML-only mail: &amp; in the href comes back as &', async () => {
    expect(await linkFor('html-only-amp', 'html@example.com')).toBe(
      'https://app.example.com/auth/verify?token=html123&type=magiclink&redirect_to=https://app.example.com/home',
    );
  });

  test('plain text is not HTML-unescaped (&section= must not become a section sign)', async () => {
    const link = await linkFor('plain-ampersand', 'amp@example.com');
    expect(link).toBe('https://app.example.com/auth/verify?token=amp123&section=2&type=magiclink');
    expect(link).not.toContain('§');
  });

  test('a hash-router link keeps its second fragment', async () => {
    expect(await linkFor('fragment-link', 'fragment@example.com')).toBe(
      'https://app.example.com/#/sign-in/link#otp=123456',
    );
  });

  test('text/plain is preferred over an HTML part listed first', async () => {
    expect(await linkFor('multipart-plain-preferred', 'alt@example.com')).toBe(
      'https://app.example.com/plain-version?token=plain',
    );
  });

  test('HTML is searched when text/plain has no match', async () => {
    expect(await linkFor('multipart-html-fallback', 'fallback@example.com')).toBe(
      'https://app.example.com/only-in-html?a=1&b=2',
    );
  });

  test('the whole match is returned, whatever the pattern', async () => {
    expect(await linkFor('plus-address', 'user+tag@example.com', 'token=(plus\\d+)')).toBe('token=plus123');
  });

  test('a global RegExp gives the same answer on every poll', async () => {
    const s3Client = bucketWith('plus-address');
    const pattern = /https:\/\/app\.example\.com\/\S+/g;
    const first = await waitForLink('bucket', 'user+tag@example.com', { pattern, since: SINCE, timeout: 0, s3Client });
    const second = await waitForLink('bucket', 'user+tag@example.com', { pattern, since: SINCE, timeout: 0, s3Client });
    expect(second).toBe(first);
  });

  test('S3 bodies that are streams work too', async () => {
    const s3Client = fakeS3({
      objects: [{ key: 'raw/a', body: fixture('plus-address'), lastModified: new Date(T0) }],
      streamBodies: true,
    });
    expect(await waitForLink('bucket', 'user+tag@example.com', { pattern: APP, since: SINCE, timeout: 0, s3Client })).toBe(
      'https://app.example.com/auth/verify?token=plus123&type=magiclink',
    );
  });
});

describe('listing', () => {
  test('buckets with more than 1000 keys are fully paginated', async () => {
    // 1500 mails, the one that matters is the oldest and so sits on the second page.
    const objects = Array.from({ length: 1499 }, (_, i) => ({
      key: `raw/filler-${String(i).padStart(4, '0')}`,
      body: filler(i),
      lastModified: new Date(T0 + 10_000 + i * 1000),
    }));
    objects.push({ key: 'raw/zzz-target', body: fixture('plus-address'), lastModified: new Date(T0) });
    const s3Client = fakeS3({ objects, pageSize: 1000 });

    const link = await waitForLink('bucket', 'user+tag@example.com', { pattern: APP, since: SINCE, timeout: 0, s3Client });

    expect(link).toBe('https://app.example.com/auth/verify?token=plus123&type=magiclink');
    expect(s3Client.lists).toHaveLength(2);
    expect(s3Client.lists[1].ContinuationToken).toBe('1000');
  }, 30_000);

  test('the prefix is passed to the listing, raw/ by default', async () => {
    const s3Client = bucketWith('plus-address');
    await fetchMessages('bucket', 'user+tag@example.com', { since: SINCE, s3Client });
    await fetchMessages('bucket', 'user+tag@example.com', { since: SINCE, s3Client, prefix: 'other/' });
    expect(s3Client.lists.map((l) => l.Prefix)).toEqual(['raw/', 'other/']);
  });

  test('since: older objects are never fetched, and the boundary is inclusive', async () => {
    const s3Client = fakeS3({
      objects: [
        { key: 'raw/old-1', body: fixture('plus-address'), lastModified: new Date(T0 - 2000) },
        { key: 'raw/old-2', body: fixture('plus-address'), lastModified: new Date(T0 - 1) },
        { key: 'raw/edge', body: fixture('mixed-case-recipient'), lastModified: new Date(T0) },
        { key: 'raw/new', body: fixture('plus-address'), lastModified: new Date(T0 + 5000) },
      ],
    });

    const mails = await fetchMessages('bucket', 'user+tag@example.com', { since: new Date(T0), s3Client });

    expect(mails).toHaveLength(2);
    expect(s3Client.gets.sort()).toEqual(['raw/edge', 'raw/new']);
  });

  test('since accepts a Date, epoch milliseconds or an ISO string, and is required', async () => {
    const s3Client = bucketWith('plus-address');
    for (const since of [new Date(T0 - 1), T0 - 1, new Date(T0 - 1).toISOString()]) {
      expect(await fetchMessages('bucket', 'user+tag@example.com', { since, s3Client })).toHaveLength(1);
    }
    await expect(fetchMessages('bucket', 'user+tag@example.com', { s3Client })).rejects.toThrow(TypeError);
    await expect(fetchMessages('bucket', 'user+tag@example.com', { since: 'nonsense', s3Client })).rejects.toThrow(TypeError);
  });

  test('fetchMessages returns the newest mail first', async () => {
    const s3Client = fakeS3({
      objects: [
        { key: 'raw/a', body: fixture('plus-address'), lastModified: new Date(T0 + 1000) },
        { key: 'raw/b', body: fixture('mixed-case-recipient'), lastModified: new Date(T0 + 3000) },
        { key: 'raw/c', body: fixture('plus-address'), lastModified: new Date(T0 + 2000) },
      ],
    });
    const mails = await fetchMessages('bucket', 'user+tag@example.com', { since: SINCE, s3Client });
    expect(mails.map((m) => m.to.value[0].address)).toEqual(['User+Tag@EXAMPLE.com', 'user+tag@example.com', 'user+tag@example.com']);
    expect(s3Client.gets).toEqual(['raw/b', 'raw/c', 'raw/a']);
  });

  test('the newest qualifying mail wins', async () => {
    const s3Client = fakeS3({
      objects: [
        { key: 'raw/a', body: fixture('plus-address'), lastModified: new Date(T0 + 1000) },
        { key: 'raw/b', body: fixture('mixed-case-recipient'), lastModified: new Date(T0 + 2000) },
      ],
    });
    const link = await waitForLink('bucket', 'user+tag@example.com', { pattern: APP, since: SINCE, timeout: 0, s3Client });
    expect(link).toBe('https://app.example.com/auth/verify?token=case123');
    expect(s3Client.gets).toEqual(['raw/b']);
  });

  test('NoSuchKey (expired between list and get) is skipped', async () => {
    const s3Client = fakeS3({
      objects: [
        { key: 'raw/a', body: fixture('plus-address'), lastModified: new Date(T0) },
        { key: 'raw/b', body: fixture('mixed-case-recipient'), lastModified: new Date(T0 + 1000) },
      ],
      onGet: (key) => {
        if (key === 'raw/b') {
          throw awsError('NoSuchKey');
        }
      },
    });
    const link = await waitForLink('bucket', 'user+tag@example.com', { pattern: APP, since: SINCE, timeout: 0, s3Client });
    expect(link).toBe('https://app.example.com/auth/verify?token=plus123&type=magiclink');
  });
});

describe('polling', () => {
  test('raises MailTimeout when nothing matches in time, without real waiting', async () => {
    const clock = fakeClock();
    const s3Client = bucketWith('plus-address');

    const result = waitForLink('bucket', 'nobody@example.com', {
      pattern: APP,
      since: SINCE,
      timeout: 10_000,
      pollInterval: 4000,
      s3Client,
      sleep: clock.sleep,
      now: clock.now,
    });

    await expect(result).rejects.toThrow(MailTimeout);
    await expect(result).rejects.toMatchObject({ name: 'MailTimeout' });
    await expect(result).rejects.toBeInstanceOf(Error);
    // 4s + 4s + the 2s that remained, then the final attempt fails the deadline check.
    expect(clock.sleeps).toEqual([4000, 4000, 2000]);
    expect(s3Client.lists).toHaveLength(4);
  });

  test('one attempt is made even with a zero timeout', async () => {
    const s3Client = bucketWith('plus-address');
    await expect(
      waitForLink('bucket', 'nobody@example.com', { pattern: APP, since: SINCE, timeout: 0, s3Client }),
    ).rejects.toThrow(MailTimeout);
    expect(s3Client.lists).toHaveLength(1);
  });

  test('a mail that arrives later is found, and mails already read are not downloaded again', async () => {
    const clock = fakeClock();
    const objects = [
      // Addressed to the right person, but no link: read once, then remembered.
      { key: 'raw/no-link', body: Buffer.from('From: a@example.org\r\nTo: wait@example.com\r\nSubject: hi\r\n\r\nnothing here\r\n'), lastModified: new Date(T0) },
      // Not addressed to the right person: read once, then remembered.
      { key: 'raw/other', body: filler(1), lastModified: new Date(T0 + 1000) },
    ];
    const s3Client = fakeS3({
      objects: () => objects,
      onList: (call) => {
        if (call === 3) {
          objects.push({ key: 'raw/arrived', body: fixture('plus-address'), lastModified: new Date(T0 + 5000) });
        }
      },
    });

    const link = await waitForLink('bucket', 'user+tag@example.com', {
      pattern: APP,
      since: SINCE,
      timeout: 60_000,
      pollInterval: 2000,
      s3Client,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(link).toBe('https://app.example.com/auth/verify?token=plus123&type=magiclink');
    expect(s3Client.lists).toHaveLength(3);
    expect(clock.sleeps).toEqual([2000, 2000]);
    expect(s3Client.gets.filter((k) => k === 'raw/other')).toHaveLength(1);
    expect(s3Client.gets.filter((k) => k === 'raw/arrived')).toHaveLength(1);
    // Every other key was fetched exactly once across the three polls.
    expect(s3Client.gets.sort()).toEqual(['raw/arrived', 'raw/no-link', 'raw/other']);
  });

  test('a mail without a match for the pattern is read once across polls', async () => {
    const clock = fakeClock();
    const s3Client = bucketWith('plus-address');
    await expect(
      waitForLink('bucket', 'user+tag@example.com', {
        pattern: 'https://nowhere\\.example\\.net/\\S+',
        since: SINCE,
        timeout: 6000,
        pollInterval: 2000,
        s3Client,
        sleep: clock.sleep,
        now: clock.now,
      }),
    ).rejects.toThrow(MailTimeout);
    expect(s3Client.lists).toHaveLength(4);
    expect(s3Client.gets).toEqual(['raw/plus-address']);
  });

  test('pattern is required', async () => {
    await expect(waitForLink('bucket', 'a@example.com', { since: SINCE, s3Client: bucketWith() })).rejects.toThrow(TypeError);
  });
});

describe('AWS errors', () => {
  test.each(['AccessDenied', 'NoSuchBucket'])('%s on the listing propagates after exactly one call', async (name) => {
    const clock = fakeClock();
    const s3Client = fakeS3({
      objects: [],
      onList: () => {
        throw awsError(name);
      },
    });

    await expect(
      waitForLink('bucket', 'user+tag@example.com', {
        pattern: APP,
        since: SINCE,
        timeout: 60_000,
        s3Client,
        sleep: clock.sleep,
        now: clock.now,
      }),
    ).rejects.toMatchObject({ name });
    expect(s3Client.lists).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  test('AccessDenied on a GetObject propagates and is not retried', async () => {
    const clock = fakeClock();
    const s3Client = fakeS3({
      objects: [{ key: 'raw/a', body: fixture('plus-address'), lastModified: new Date(T0) }],
      onGet: () => {
        throw awsError('AccessDenied');
      },
    });

    await expect(
      waitForLink('bucket', 'user+tag@example.com', {
        pattern: APP,
        since: SINCE,
        timeout: 60_000,
        s3Client,
        sleep: clock.sleep,
        now: clock.now,
      }),
    ).rejects.toMatchObject({ name: 'AccessDenied' });
    expect(s3Client.gets).toEqual(['raw/a']);
    expect(clock.sleeps).toEqual([]);
  });

  test('fetchMessages propagates AWS errors too', async () => {
    const s3Client = fakeS3({
      objects: [],
      onList: () => {
        throw awsError('AccessDenied');
      },
    });
    await expect(fetchMessages('bucket', 'a@example.com', { since: SINCE, s3Client })).rejects.toMatchObject({
      name: 'AccessDenied',
    });
  });
});

describe('linkPattern', () => {
  test('matches the prefix literally up to whitespace, quotes and angle brackets', () => {
    const pattern = linkPattern('https://app.example.com/');
    expect(pattern.exec('see <a href="https://app.example.com/x?a=1#/y#z">here</a>')[0]).toBe(
      'https://app.example.com/x?a=1#/y#z',
    );
    expect(pattern.exec('https://app-example.com/x')).toBeNull(); // the dots are literal
  });

  test('regular expression characters in the prefix are escaped', () => {
    expect(linkPattern('https://a.example.com/(x)+/').exec('go https://a.example.com/(x)+/ok now')[0]).toBe(
      'https://a.example.com/(x)+/ok',
    );
  });
});
