import os
import json
import pytest
import supabase
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from api.main import app
from api.auth import require_auth
from config.settings import get_settings

class MockUser:
    def __init__(self, user_id, email="test@example.com"):
        self.id = user_id
        self.email = email
    def model_dump(self):
        return {"id": self.id, "email": self.email}

class MockResponse:
    def __init__(self, user):
        self.user = user

@pytest.fixture
def mock_supabase(monkeypatch):
    from config.settings import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "supabase_url", "https://dummy-supabase-url.supabase.co")
    monkeypatch.setattr(settings, "supabase_key", "dummy-supabase-key")

    mock_client = MagicMock()
    monkeypatch.setattr(supabase, "create_client", lambda url, key: mock_client)

    import api.auth
    monkeypatch.setattr(api.auth, "create_client", lambda url, key: mock_client)

    return mock_client

@pytest.fixture
def dummy_static_file():
    os.makedirs("data/videos_gerados", exist_ok=True)
    path = "data/videos_gerados/sess_123_final.mp4"
    with open(path, "w") as f:
        f.write("dummy-video-data")
    yield path
    if os.path.exists(path):
        os.remove(path)

def test_auth_static_files_options_bypass(client, dummy_static_file):
    # OPTIONS request should bypass auth
    response = client.options("/videos_gerados/sess_123_final.mp4")
    assert response.status_code == 200

def test_auth_static_files_dependency_override_bypass(client, dummy_static_file):
    # When require_auth is in app.dependency_overrides, auth is bypassed
    response = client.get("/videos_gerados/sess_123_final.mp4")
    assert response.status_code == 200
    assert response.text == "dummy-video-data"

def test_auth_static_files_missing_token(raw_client, dummy_static_file):
    # No auth header or query param token
    response = raw_client.get("/videos_gerados/sess_123_final.mp4")
    assert response.status_code == 401
    assert "Unauthorized" in response.text

def test_auth_static_files_invalid_token(raw_client, mock_supabase, dummy_static_file):
    # Mock token validation failure
    mock_supabase.auth.get_user.side_effect = Exception("Invalid token")
    response = raw_client.get("/videos_gerados/sess_123_final.mp4", headers={"Authorization": "Bearer invalid"})
    assert response.status_code == 401
    assert "Unauthorized" in response.text
    # Should not leak exception details
    assert "Invalid token" not in response.text

def test_auth_static_files_session_not_found(raw_client, mock_supabase, dummy_static_file):
    # Valid token, but session_id not in pipeline_runs
    mock_supabase.auth.get_user.return_value = MockResponse(MockUser("user_123"))
    
    mock_members_res = MagicMock()
    mock_members_res.data = [{"organization_id": "org_123"}]
    
    mock_runs_res = MagicMock()
    mock_runs_res.data = [] # empty pipeline_runs
    
    def mock_table_side_effect(table_name):
        t = MagicMock()
        s = MagicMock()
        e = MagicMock()
        t.select.return_value = s
        s.eq.return_value = e
        if table_name == "organization_members":
            e.execute.return_value = mock_members_res
        elif table_name == "pipeline_runs":
            e.execute.return_value = mock_runs_res
        return t
        
    mock_supabase.table.side_effect = mock_table_side_effect
    
    response = raw_client.get("/videos_gerados/sess_123_final.mp4", headers={"Authorization": "Bearer valid_token"})
    assert response.status_code == 403
    assert "Forbidden: session not found" in response.text

def test_auth_static_files_wrong_organization(raw_client, mock_supabase, dummy_static_file):
    # Valid token, but session organization does not match user's organizations
    mock_supabase.auth.get_user.return_value = MockResponse(MockUser("user_123"))
    
    mock_members_res = MagicMock()
    mock_members_res.data = [{"organization_id": "org_123"}]
    
    mock_runs_res = MagicMock()
    mock_runs_res.data = [{"organization_id": "org_999"}] # session belongs to different org
    
    def mock_table_side_effect(table_name):
        t = MagicMock()
        s = MagicMock()
        e = MagicMock()
        t.select.return_value = s
        s.eq.return_value = e
        if table_name == "organization_members":
            e.execute.return_value = mock_members_res
        elif table_name == "pipeline_runs":
            e.execute.return_value = mock_runs_res
        return t
        
    mock_supabase.table.side_effect = mock_table_side_effect
    
    response = raw_client.get("/videos_gerados/sess_123_final.mp4", headers={"Authorization": "Bearer valid_token"})
    assert response.status_code == 403
    assert "Forbidden: session does not belong to your organization" in response.text

def test_auth_static_files_correct_organization_header(raw_client, mock_supabase, dummy_static_file):
    # Valid token, correct org, token in Authorization header
    mock_supabase.auth.get_user.return_value = MockResponse(MockUser("user_123"))
    
    mock_members_res = MagicMock()
    mock_members_res.data = [{"organization_id": "org_123"}]
    
    mock_runs_res = MagicMock()
    mock_runs_res.data = [{"organization_id": "org_123"}]
    
    def mock_table_side_effect(table_name):
        t = MagicMock()
        s = MagicMock()
        e = MagicMock()
        t.select.return_value = s
        s.eq.return_value = e
        if table_name == "organization_members":
            e.execute.return_value = mock_members_res
        elif table_name == "pipeline_runs":
            e.execute.return_value = mock_runs_res
        return t
        
    mock_supabase.table.side_effect = mock_table_side_effect
    
    response = raw_client.get("/videos_gerados/sess_123_final.mp4", headers={"Authorization": "Bearer valid_token"})
    assert response.status_code == 200
    assert response.text == "dummy-video-data"

def test_auth_static_files_correct_organization_query_param(raw_client, mock_supabase, dummy_static_file):
    # Valid token, correct org, token in query parameter
    mock_supabase.auth.get_user.return_value = MockResponse(MockUser("user_123"))
    
    mock_members_res = MagicMock()
    mock_members_res.data = [{"organization_id": "org_123"}]
    
    mock_runs_res = MagicMock()
    mock_runs_res.data = [{"organization_id": "org_123"}]
    
    def mock_table_side_effect(table_name):
        t = MagicMock()
        s = MagicMock()
        e = MagicMock()
        t.select.return_value = s
        s.eq.return_value = e
        if table_name == "organization_members":
            e.execute.return_value = mock_members_res
        elif table_name == "pipeline_runs":
            e.execute.return_value = mock_runs_res
        return t
        
    mock_supabase.table.side_effect = mock_table_side_effect
    
    response = raw_client.get("/videos_gerados/sess_123_final.mp4?token=valid_token")
    assert response.status_code == 200
    assert response.text == "dummy-video-data"
