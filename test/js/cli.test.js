'use strict';

const { main } = require('../../lib/cli');
const { fixture, awsError, fakeS3 } = require('./helpers');

const T0 = Date.parse('2026-01-01T12:00:00Z');

function bucket(onList) {
  return fakeS3({
    objects: [{ key: 'raw/a', body: fixture('fragment-link'), lastModified: new Date(T0) }],
    onList,
  });
}

async function run(argv, s3Client) {
  const out = [];
  const err = [];
  const code = await main(argv, { stdout: (l) => out.push(l), stderr: (l) => err.push(l), s3Client });
  return { code, out, err };
}

describe('maildummy-link', () => {
  test('--url-prefix prints the link and exits 0', async () => {
    const { code, out } = await run(
      ['bucket', 'fragment@example.com', '--url-prefix', 'https://app.example.com/', '--since', '2026-01-01T00:00:00'],
      bucket(),
    );
    expect(code).toBe(0);
    expect(out).toEqual(['https://app.example.com/#/sign-in/link#otp=123456']);
  });

  test('--pattern takes a regular expression', async () => {
    const { code, out } = await run(['bucket', 'fragment@example.com', '--pattern', 'otp=(\\d+)'], bucket());
    expect(code).toBe(0);
    expect(out).toEqual(['otp=123456']);
  });

  test('--since is read as UTC when it has no zone, and filters older mail', async () => {
    const args = ['bucket', 'fragment@example.com', '--pattern', 'otp=\\d+', '--timeout', '0'];
    expect((await run([...args, '--since', '2026-01-01T12:00:00'], bucket())).code).toBe(0);
    expect((await run([...args, '--since', '2026-01-01T12:00:01'], bucket())).code).toBe(1);
    expect((await run([...args, '--since', '2026-01-01T13:00:01+01:00'], bucket())).code).toBe(1);
    expect((await run([...args, '--since', '2026-01-01T12:00:00Z'], bucket())).code).toBe(0);
  });

  test('a timeout prints an error to stderr and exits 1', async () => {
    const { code, out, err } = await run(
      ['bucket', 'nobody@example.com', '--pattern', 'x', '--timeout', '0'],
      bucket(),
    );
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err[0]).toMatch(/^Error: no mail to nobody@example\.com/);
  });

  test('an AWS error exits 1 after one call', async () => {
    const s3Client = bucket(() => {
      throw awsError('AccessDenied');
    });
    const { code, err } = await run(['bucket', 'a@example.com', '--pattern', 'x', '--timeout', '60'], s3Client);
    expect(code).toBe(1);
    expect(err[0]).toBe('Error: AccessDenied');
    expect(s3Client.lists).toHaveLength(1);
  });

  test.each([
    [['bucket', 'a@example.com']],
    [['bucket', 'a@example.com', '--pattern', 'x', '--url-prefix', 'https://x/']],
    [['bucket', '--pattern', 'x']],
    [['bucket', 'a@example.com', '--pattern', 'x', '--bogus']],
    [['bucket', 'a@example.com', '--pattern', 'x', '--since', 'yesterday']],
    [['bucket', 'a@example.com', '--pattern', 'x', '--timeout', 'soon']],
  ])('bad arguments %j exit 2 with usage', async (argv) => {
    const { code, out, err } = await run(argv, bucket());
    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(err.join('\n')).toMatch(/Usage: maildummy-link/);
  });
});
