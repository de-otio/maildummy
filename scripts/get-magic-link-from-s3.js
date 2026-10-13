#!/usr/bin/env node
'use strict';

/**
 * Deprecated: compatibility shim for `maildummy-link` (bin/maildummy-link.js)
 * and the library in lib/maildummy.js. It no longer guesses at Supabase or
 * `token=` links, so pass `--pattern` or `--url-prefix`.
 *
 *   node scripts/get-magic-link-from-s3.js <bucket> <address> --url-prefix https://app.example.com/
 */

module.exports = require('../lib/maildummy');

if (require.main === module) {
  require('../lib/cli')
    .main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    });
}
