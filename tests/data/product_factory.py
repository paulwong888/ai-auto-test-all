from dataclasses import dataclass


@dataclass(frozen=True)
class Product:
    slug: str
    name: str
    item_link_test_id: str


BACKPACK = Product(
    slug="sauce-labs-backpack",
    name="Sauce Labs Backpack",
    item_link_test_id="item-4-title-link",
)

BIKE_LIGHT = Product(
    slug="sauce-labs-bike-light",
    name="Sauce Labs Bike Light",
    item_link_test_id="item-0-title-link",
)

BOLT_T_SHIRT = Product(
    slug="sauce-labs-bolt-t-shirt",
    name="Sauce Labs Bolt T-Shirt",
    item_link_test_id="item-1-title-link",
)

ONESIE = Product(
    slug="sauce-labs-onesie",
    name="Sauce Labs Onesie",
    item_link_test_id="item-2-title-link",
)
