import os
from sqlmodel import SQLModel, create_engine, Session

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)

SQLITE_FILE_PATH = os.path.join(DATA_DIR, "app.db")
DATABASE_URL = f"sqlite:///{SQLITE_FILE_PATH}"

# connect_args={"check_same_thread": False} is required for SQLite with multi-threaded FastAPI
engine = create_engine(DATABASE_URL, echo=False, connect_args={"check_same_thread": False})

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    try:
        with engine.connect() as conn:
            cursor = conn.exec_driver_sql("PRAGMA table_info(conversation);")
            columns = [row[1] for row in cursor.fetchall()]
            if "visitor_email" not in columns:
                conn.exec_driver_sql("ALTER TABLE conversation ADD COLUMN visitor_email TEXT;")
            if "bot_paused_until" not in columns:
                conn.exec_driver_sql("ALTER TABLE conversation ADD COLUMN bot_paused_until TIMESTAMP;")

            cursor = conn.exec_driver_sql("PRAGMA table_info(calendarbooking);")
            booking_columns = [row[1] for row in cursor.fetchall()]
            for name, ddl in [
                ("service_id", "INTEGER"),
                ("staff_id", "INTEGER"),
                ("staff_name", "TEXT"),
                ("duration_minutes", "INTEGER NOT NULL DEFAULT 30"),
            ]:
                if name not in booking_columns:
                    conn.exec_driver_sql(f"ALTER TABLE calendarbooking ADD COLUMN {name} {ddl};")
            conn.commit()
    except Exception as e:
        print(f"[Database Migration Warning] {e}")

def get_session():
    with Session(engine) as session:
        yield session
