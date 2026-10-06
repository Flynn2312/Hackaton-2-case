from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Query
from supabase import Client

from app.core.database import get_supabase

DB = Annotated[Client, Depends(get_supabase)]


@dataclass
class Pagination:
    limit: int = Query(100, ge=1, le=1000, description="Сколько записей вернуть")
    offset: int = Query(0, ge=0, description="Сколько записей пропустить")


Page = Annotated[Pagination, Depends()]


def found[T](item: T | None, entity: str) -> T:
    if item is None:
        raise HTTPException(status_code=404, detail=f"{entity} not found")
    return item
