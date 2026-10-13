#!/usr/bin/env python3

"""
Deprecated shim for the `maildummy-link` command of the `maildummy` Python package
(see python/ and docs/helper-scripts.md).

Usage:
    python scripts/get-magic-link-from-s3.py <bucket-name> <email-address> \
        (--pattern <regex> | --url-prefix <prefix>) [--region <region>] [--since <iso8601>] \
        [--timeout <seconds>]

Works from a repository checkout when boto3 is installed; no package install needed.
"""

import sys
from pathlib import Path

try:
    from maildummy.cli import main
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python" / "src"))
    from maildummy.cli import main

if __name__ == "__main__":
    sys.exit(main())
