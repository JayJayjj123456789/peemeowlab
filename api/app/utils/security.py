"""Security helpers."""

import secrets


def new_request_id() -> str:
    return secrets.token_hex(8)
