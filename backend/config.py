import os
from typing import List
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DEMO_MODE: str = os.getenv("DEMO_MODE", "mock")
    PORT: int = int(os.getenv("PORT", "8000"))
    HOST: str = os.getenv("HOST", "0.0.0.0")

    # watsonx.data Presto / Trino Settings
    PRESTO_HOST: str = os.getenv("PRESTO_HOST", "localhost")
    PRESTO_PORT: int = int(os.getenv("PRESTO_PORT", "8443"))
    PRESTO_USER: str = os.getenv("PRESTO_USER", "ibmacp")
    PRESTO_PASSWORD: str = os.getenv("PRESTO_PASSWORD", "")
    # JWT bearer token – preferred auth for watsonx.data service accounts
    PRESTO_BEARER_TOKEN: str = os.getenv("PRESTO_BEARER_TOKEN", "")
    # Default catalog/schema used as the Trino connection's session default
    # and as the fallback when catalog/schema cannot be parsed from SQL.
    # These do NOT limit which catalogs are discovered — all catalogs visible
    # to PRESTO_USER are always enumerated via SHOW CATALOGS.
    # CP4D console hostname used to exchange username+password for a bearer token.
    # Defaults to PRESTO_HOST when not set (they are often the same).
    PRESTO_CPD_HOST: str = os.getenv("PRESTO_CPD_HOST", "")
    PRESTO_CATALOG: str = os.getenv("PRESTO_CATALOG", "iceberg_data")
    PRESTO_SCHEMA: str = os.getenv("PRESTO_SCHEMA", "finance")
    PRESTO_USE_SSL: bool = os.getenv("PRESTO_USE_SSL", "false").lower() == "true"
    # Set to "false" to skip TLS verification for self-signed certificates
    PRESTO_SSL_VERIFY: bool = os.getenv("PRESTO_SSL_VERIFY", "true").lower() == "true"

    # Simulated SIEM Engine Settings
    SIEM_SIMULATION_ENABLED: bool = True
    SIEM_FORWARD_HOST: str = os.getenv("SIEM_FORWARD_HOST", "")
    SIEM_FORWARD_PORT: int = int(os.getenv("SIEM_FORWARD_PORT", "514"))
    SIEM_FORWARD_PROTOCOL: str = os.getenv("SIEM_FORWARD_PROTOCOL", "UDP")
    SIEM_FORMAT: str = os.getenv("SIEM_FORMAT", "LEEF_2_0")

    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "*"
    ]

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
