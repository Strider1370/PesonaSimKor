from pathlib import Path

from app.config.env import load_backend_environment


def test_load_backend_environment_reads_env_file_without_overriding_existing_env(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("OPENAI_API_KEY=sk-from-file\nEXISTING=value-from-file\n", encoding="utf-8")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("EXISTING", "already-set")

    load_backend_environment([Path(env_file)])

    assert "sk-from-file" == __import__("os").getenv("OPENAI_API_KEY")
    assert "already-set" == __import__("os").getenv("EXISTING")
