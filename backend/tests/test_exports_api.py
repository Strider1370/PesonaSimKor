from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


def test_save_project_csv_export_writes_csv_and_snapshot_sidecar(tmp_path, monkeypatch):
    monkeypatch.setenv("KOREANSIM_EXPORTS_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.post(
        "/api/exports/csv",
        json={
            "filename": "../사형_1",
            "content": "snapshot_id,name\n1,test\n",
            "snapshot": {"name": "test", "slots": [], "results": [], "settings": {}},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["filename"] == "사형_1.csv"
    assert payload["path"] == "exports/사형_1.csv"
    assert payload["bytes"] == len("snapshot_id,name\n1,test\n".encode("utf-8-sig"))
    assert (tmp_path / "사형_1.csv").read_text(encoding="utf-8-sig") == "snapshot_id,name\n1,test\n"
    assert (tmp_path / "사형_1.json").exists()


def test_save_project_csv_export_uses_unique_filename(tmp_path, monkeypatch):
    monkeypatch.setenv("KOREANSIM_EXPORTS_DIR", str(tmp_path))
    (tmp_path / "result.csv").write_text("old", encoding="utf-8")
    client = TestClient(app)

    response = client.post("/api/exports/csv", json={"filename": "result.csv", "content": "new"})

    assert response.status_code == 200
    assert response.json()["filename"] == "result_2.csv"
    assert (tmp_path / "result.csv").read_text(encoding="utf-8") == "old"
    assert (tmp_path / "result_2.csv").read_text(encoding="utf-8-sig") == "new"


def test_list_and_load_project_csv_exports(tmp_path, monkeypatch):
    monkeypatch.setenv("KOREANSIM_EXPORTS_DIR", str(tmp_path))
    (tmp_path / "a.csv").write_text("a", encoding="utf-8-sig")
    (tmp_path / "a.json").write_text('{"name":"loaded"}', encoding="utf-8")
    (tmp_path / "b.csv").write_text("b", encoding="utf-8-sig")
    client = TestClient(app)

    listed = client.get("/api/exports/csv").json()
    loaded = client.get("/api/exports/csv/a.csv").json()

    assert [item["filename"] for item in listed["items"]] == ["b.csv", "a.csv"]
    assert listed["items"][0]["path"] == "exports/b.csv"
    assert loaded == {"filename": "a.csv", "content": "a", "snapshot": {"name": "loaded"}}


def test_load_project_csv_export_rejects_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setenv("KOREANSIM_EXPORTS_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.get("/api/exports/csv/..%2Fsecret.csv")

    assert response.status_code == 400
