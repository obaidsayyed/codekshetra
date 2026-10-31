"""
Tests for laptop control and hardware access tools.
"""
from app.tools.laptop import SystemStatusTool, OpenFolderTool, LaunchAppTool, SearchLaptopFilesTool


def test_system_status_tool():
    tool = SystemStatusTool()
    res = tool.execute()
    assert res.success is True
    assert "cpu_percent" in res.data
    assert "ram_percent" in res.data
    assert "disk_free_gb" in res.data
    assert "CPU" in res.evidence


def test_search_laptop_files():
    tool = SearchLaptopFilesTool()
    # Search for anything on Desktop or Workspace
    res = tool.execute(query="sunday", location="Workspace")
    assert res.success is True
    assert "matches" in res.data

