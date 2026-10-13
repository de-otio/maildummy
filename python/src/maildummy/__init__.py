"""Fetch mail captured by a maildummy S3 bucket."""

from maildummy.fetch import MailTimeout, fetch_messages, link_pattern, wait_for_link

__all__ = ["MailTimeout", "fetch_messages", "link_pattern", "wait_for_link"]
