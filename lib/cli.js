'use strict';

/** `maildummy-link`: print the first matching link from a maildummy bucket. Same flags as the Python CLI. */

const { parseArgs } = require('node:util');
const { DEFAULT_PREFIX, linkPattern, waitForLink } = require('./maildummy');

const USAGE = `Usage: maildummy-link <bucket> <address> (--pattern <regex> | --url-prefix <prefix>)
         [--region <region>] [--since <iso8601>] [--timeout <seconds>]
         [--poll-interval <seconds>] [--prefix <key-prefix>]

Prints the first link matching the pattern in the newest mail to <address>.
--since ignores older mail (naive timestamps are UTC; default: no limit).
--timeout and --poll-interval are in seconds (defaults 60 and 2).
--prefix is the S3 key prefix (default ${DEFAULT_PREFIX}).`;

class UsageError extends Error {}

function parseSince(value) {
  // A timestamp without a zone designator is UTC, as in the Python CLI.
  const time = value.replace(/^\d{4}-\d{2}-\d{2}/, '');
  const naive = /^[T ]\d{2}:\d{2}/i.test(time) && !/(Z|[+-]\d{2}(:?\d{2})?)$/i.test(time);
  const date = new Date(naive ? `${value.replace(' ', 'T')}Z` : value);
  if (Number.isNaN(date.getTime())) {
    throw new UsageError(`--since: not an ISO 8601 timestamp: ${value}`);
  }
  return date;
}

function seconds(name, value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new UsageError(`--${name}: not a non-negative number: ${value}`);
  }
  return n;
}

/**
 * @param {string[]} argv arguments after the program name
 * @param {{ stdout?: (line: string) => void, stderr?: (line: string) => void, s3Client?: object }} [io]
 * @returns {Promise<number>} the exit code
 */
async function main(argv, io = {}) {
  const stdout = io.stdout || ((line) => console.log(line));
  const stderr = io.stderr || ((line) => console.error(line));
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        pattern: { type: 'string' },
        'url-prefix': { type: 'string' },
        region: { type: 'string' },
        since: { type: 'string' },
        timeout: { type: 'string' },
        'poll-interval': { type: 'string' },
        prefix: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help) {
      stdout(USAGE);
      return 0;
    }
    if (positionals.length !== 2) {
      throw new UsageError('expected <bucket> and <address>');
    }
    if ((values.pattern === undefined) === (values['url-prefix'] === undefined)) {
      throw new UsageError('exactly one of --pattern and --url-prefix is required');
    }
    const [bucket, address] = positionals;
    const link = await waitForLink(bucket, address, {
      pattern: values.pattern !== undefined ? values.pattern : linkPattern(values['url-prefix']),
      since: values.since !== undefined ? parseSince(values.since) : new Date(0),
      timeout: seconds('timeout', values.timeout, 60) * 1000,
      pollInterval: seconds('poll-interval', values['poll-interval'], 2) * 1000,
      region: values.region,
      prefix: values.prefix,
      s3Client: io.s3Client,
    });
    stdout(link);
    return 0;
  } catch (err) {
    stderr(`Error: ${err.message}`);
    if (err instanceof UsageError || err.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      stderr(USAGE);
      return 2;
    }
    return 1;
  }
}

module.exports = { main };
