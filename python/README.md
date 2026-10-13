# maildummy (Python)

Fetch sign-in links, one-time codes and other mail captured by a
[maildummy](https://github.com/de-otio/maildummy) S3 bucket, for end-to-end tests.
The only runtime dependency is `boto3`; Python 3.11 or later.

```bash
pip install "maildummy @ git+https://github.com/de-otio/maildummy@<tag>#subdirectory=python"
```

```python
from datetime import datetime, timezone

from maildummy import link_pattern, wait_for_link

started = datetime.now(timezone.utc)
# ... trigger the sign-in mail for test-123@maildummy.example.com ...
link = wait_for_link(
    "my-maildummy-bucket",
    "test-123@maildummy.example.com",
    pattern=link_pattern("https://app.example.com/"),
    since=started,
)
```

See `docs/helper-scripts.md` in the repository for the full reference and the
`maildummy-link` command.
