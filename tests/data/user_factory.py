import secrets
import string

VALID_USERNAME = "standard_user"
VALID_PASSWORD = "secret_sauce"
LOCKED_USERNAME = "locked_out_user"


def valid_user() -> tuple[str, str]:
    return VALID_USERNAME, VALID_PASSWORD


def locked_user() -> tuple[str, str]:
    return LOCKED_USERNAME, VALID_PASSWORD


def invalid_user() -> tuple[str, str]:
    suffix = "".join(secrets.choice(string.ascii_lowercase) for _ in range(8))
    return f"invalid_{suffix}", VALID_PASSWORD


def wrong_password_user() -> tuple[str, str]:
    return VALID_USERNAME, "wrong_password"


def empty_username_user() -> tuple[str, str]:
    return "", VALID_PASSWORD
