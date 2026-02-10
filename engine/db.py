from sqlmodel import SQLModel, create_engine, Session
import os

# Database URL from environment or default to local docker service
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@db:5432/movieshaker")

engine = create_engine(DATABASE_URL, echo=True)

def init_db():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
