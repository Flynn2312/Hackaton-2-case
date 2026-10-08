from typing import Annotated

from fastapi import Depends
from supabase import Client

from app.core.database import get_supabase

DB = Annotated[Client, Depends(get_supabase)]
