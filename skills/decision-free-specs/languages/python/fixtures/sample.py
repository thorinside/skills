"""Fixture with a known inventory — used to validate inventory.py."""

import json
import os
from dataclasses import dataclass
from functools import lru_cache

__all__ = ["PAGE_SIZE", "Widget", "load_widget", "WidgetError"]

PAGE_SIZE = 50
_CACHE_DIR = "/tmp/widgets"

type WidgetId = str


class WidgetError(Exception):
    """Known error type."""


@dataclass
class Widget:
    name: str
    size: int

    def area(self) -> int:
        return self.size * self.size

    def _validate(self) -> None:
        if self.size < 0:
            raise WidgetError(self.name)


class _Internal:
    def helper(self) -> None:
        pass


@lru_cache(maxsize=128)
def load_widget(widget_id: WidgetId) -> Widget:
    payload = json.loads(os.environ.get("WIDGET", "{}"))
    return Widget(name=payload.get("name", widget_id), size=PAGE_SIZE)


def _resolve(name: str):
    return getattr(json, name)


async def _refresh() -> None:
    pass
