import random
import secrets
import string
from dataclasses import dataclass


@dataclass
class CheckoutInfo:
    first_name: str
    last_name: str
    postal_code: str


def random_checkout_info() -> CheckoutInfo:
    letters = "".join(secrets.choice(string.ascii_uppercase) for _ in range(4))
    digits = "".join(str(random.randint(0, 9)) for _ in range(4))
    postal = "".join(str(random.randint(0, 9)) for _ in range(5))
    return CheckoutInfo(
        first_name=f"Test{letters}",
        last_name=f"User{digits}",
        postal_code=postal,
    )


def empty_checkout_info() -> CheckoutInfo:
    return CheckoutInfo(first_name="", last_name="", postal_code="")
